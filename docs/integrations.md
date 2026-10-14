# Integrações e situação real

## Mercado Livre por loja

As aplicações são cadastradas na própria interface: **Configurações → Integrações → Configurar integração**. ID e chave pertencem à loja selecionada; o formulário exibe e copia os endereços de retorno/notificações. Adicionar outra loja ou aplicativo não exige código, variáveis de hospedagem ou novo deploy. Para editar, a chave não é devolvida ao navegador: campo vazio mantém o segredo do mesmo ID. A autorização do vendedor é uma etapa separada pelo botão **Conectar conta ML**.

O segredo é protegido com AES-256-GCM em `ml_applications`, usando AAD da conexão para impedir a troca de ciphertext entre lojas. Configurações possuem versão; edição concorrente não sobrescreve silenciosamente. Alterar aplicativo/chave remove somente seus tokens e exige nova autorização; salvar os mesmos valores preserva a conexão. Histórico guarda apenas o ID da aplicação. Credenciais antigas em variáveis permanecem como compatibilidade até migração pelo formulário.

OAuth por loja com `state` de uso único, expiração de dez minutos, cookie HttpOnly SameSite=Lax e PKCE S256. A troca/renovação ocorre no servidor; tokens e verificador são protegidos com AES-256-GCM em coleções privadas do Firestore. Renovações concorrentes usam bloqueio temporário. O vendedor retornado por `/users/me` deve corresponder ao token, pertencer ao Brasil e não ocupar outra loja. Desconectar invalida autorizações/consultas em andamento e preserva os registros operacionais.

O retorno da autorização preserva a página, loja, busca, filtros repetidos e paginação tanto no sucesso como em falha/negação. O contexto fica no estado privado da autorização, vinculado ao operador e navegador; destinos externos/API e parâmetros de credenciais são rejeitados ou removidos. Sem contexto anterior, o retorno usa Integrações com a loja da conexão.

A interface abre a autorização em janela separada. Um canal aleatório associado ao estado privado e mensagens da mesma origem atualizam a loja na página original, sem recarregar o documento. O retorno usa CSP com nonce e não entrega tokens, código ou estado ao opener. A página continua mostrando loading até a conclusão ou cancelamento; fluxos antigos sem janela separada continuam usando o retorno por redirecionamento. A permissão **offline_access** aparece nas instruções da integração e no formulário. Conectado possui badge verde.

A troca de tokens aceita inteiros positivos seguros tanto numéricos como em texto e normaliza `Bearer`. Metadados não usados, como `scope`, não invalidam credenciais. Identidade do vendedor continua conferida em `/users/me` e na renovação. Respostas inválidas identificam apenas nomes de campos, distinguindo conexão inicial de renovação; nunca mostram valores de credenciais. Se faltar `refresh_token`, confira a permissão **offline_access** da aplicação no portal Mercado Livre e autorize novamente. Se uma renovação retornar credenciais inutilizáveis, a conexão exige nova autorização: o token anterior pode já ter sido consumido, por isso não é reenviado automaticamente.

**A autorização de vendedores reais ainda precisa ser concluída pelo usuário.** O sistema já foi publicado em HTTPS; cadastrar o aplicativo na loja não autoriza acesso à conta. O fluxo básico de OAuth foi conferido no [SDK oficial Mercado Libre](https://github.com/mercadolibre/nodejs-sdk), incluindo host brasileiro e `/oauth/token`. A documentação/API oficial retornou **HTTP 403** nas consultas deste ambiente. Os contratos de anúncios, tarifas e métricas têm validação estrita e testes com respostas simuladas, e precisam ser exercitados na aplicação autorizada. Não foram consultados anúncios privados de vendedores nem aplicados preços, ativações ou pausas reais.

| Recurso                 | Comportamento implementado                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conexão                 | Conectar/renovar/desconectar cada loja; status, vendedor, última consulta e falhas reais. Tokens nunca entram em workspace, Excel ou JSON de exportação.                                                                                                                                                                                                                               |
| Catálogo                | Busca scan, até 20 anúncios por chamada, continuação por cursor, bloqueio de execução concorrente e requisição idempotente. IDs do lote e progresso ficam registrados para retomada após uma interrupção. Se a própria consulta do cursor falhar, recomeça a busca para não pular uma página perdida.                                                                                  |
| Atualização             | Observa título, preço, status, descrição e SKU do anúncio próprio; preserva produto local, custos, tarefas, notas e snapshots. Registra diferenças confirmadas e incrementa a versão quando condições comerciais mudam, invalidando propostas antigas. Não exclui anúncios ausentes de uma página.                                                                                     |
| Variações               | Identifica variações e atributos. Se os preços variam, bloqueia proposta agregada: é necessário evoluir o mapeamento e a precificação individual. Kit não é inferido pelo título/SKU.                                                                                                                                                                                                  |
| Tarifas                 | Consulta item próprio e `listing_prices` com preço, categoria, modalidade, moeda e logística disponíveis. Aceita percentual + cobrança fixa apenas quando a decomposição corresponde ao total. Não aplica tabelas de blogs nem inventa componentes ausentes.                                                                                                                           |
| Precificação ao digitar | Cálculo local imediato, consulta oficial após pausa de 600 ms, cancelamento de respostas obsoletas e modo manual explícito se a API falhar. Uma consulta vale cinco minutos e fica vinculada a preço, oferta, versão e vendedor. O servidor verifica a consulta e substitui tarifas enviadas pelo navegador pelas consultadas.                                                         |
| Desempenho              | Últimos 30 dias de visitas e pedidos pagos criados **no mesmo intervalo retornado pelas visitas**. Unidades, pedidos, receita bruta de produtos, pedidos/visitas e perguntas não respondidas. Não utiliza `sold_quantity` acumulado como vendas do período. Não salva dados de compradores. Acima de 1.000 pedidos ou resposta incompleta, não grava métricas parciais como completas. |
| Qualidade               | Checklist de SKU/marca/descrição e dados observados: fotos, falta de estoque, atributos obrigatórios e preços de variação. Uma pendência vira tarefa sem duplicação; desconhecido não é tratado como zero. Não é um score oficial nem promessa de ranking.                                                                                                                             |
| Notificações            | Endpoint recebe `items`, `orders_v2`, `questions`, valida app/recurso e deduplica metadados em caixa de até 100 recursos recentes. Retorna 202. Payloads são sinais não verificados; não atualizam registros financeiros. O worker after() inicia consultas oficiais com reserva, retentativas e conferência de vendedor; a tela e o cron retomam pendências.                          |

O limite de execução preserva checkpoints antes de atingir o limite da função Vercel. Requisições de leitura elegíveis podem repetir 429/5xx de forma limitada; a troca de token e o scan não são repetidos cegamente. Falhas retornam mensagens sanitizadas, sem tokens, códigos OAuth, segredo ou dados de compradores.

**Ativar/pausar:** ações individuais na ficha ou seleção em Anúncios → Ações em lote. Vendedor, autorização, versão, estado oficial e estoque para ativação são conferidos. Um envio por item, leitura de confirmação, falhas individuais e retomada sem repetir PUT incerto. Edição da situação local permanece separada. Ver [tabelas e operações em lote](tables-and-bulk.md).

**Frete, promoções e subsídios:** não são inferidos da tarifa de venda. O cenário continua exigindo conferência de frete e condições adicionais. Mínimo, preço desejado e desconto máximo extrapolam custos/tarifas constantes; são estimativas que precisam de nova consulta para outro preço. Tarifas consultadas entram no cenário/proposta, sem gravar custos ou preço atual a cada tecla. Propostas aprovadas podem aplicar preço de anúncio individual elegível após nova consulta e confirmação; escrita de conteúdo/estoque, variações e promoções permanece manual. Ver [rotina integrada](daily-operation.md).

Ativação e URLs: [Publicar na Vercel](vercel.md).

## Responsabilidade por campo

| Campo                               | Responsável                         | Direção                                                                                            |
| ----------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------- |
| Produto, SKU e estoque              | ERP / ML conforme configuração real | Leitura no DATAMAT; sem escrita de estoque                                                         |
| Preço e conteúdo publicados         | ML, cliente e ERP configurado       | Observação ML → DATAMAT; proposta → aprovação → execução externa → confirmação                     |
| Tarifas e restrições                | Mercado Livre                       | Consulta por preço/categoria/modalidade; frete e promoções ainda precisam de integração específica |
| Custos, parâmetros, tarefas e notas | DATAMAT                             | Cadastro validado e histórico preservado                                                           |
| Análises aprofundadas               | Power BI                            | Exportação autorizada → BI                                                                         |

A aplicação de preço elegível usa o DATAMAT após aprovação e confirmação. Integrar escrita pelo Bling exige definir a autoridade por campo para evitar alterações concorrentes.

## Demais integrações

**Bling:** permanece pendente. Variáveis presentes não significam conta autorizada. Faltam OAuth, adapter de leitura, vínculos de produtos e responsabilidade por campo. Ver https://developer.bling.com.br/.

**IA:** permanece pendente. Checklist e prioridades atuais são regras determinísticas. Não enviam dados a um provedor de IA, nem criam características técnicas presumidas ou alegações de causalidade.

**Publicidade:** relatórios locais salvos/importados por campanha e período, indicadores de retorno/contribuição e tarefa de revisão; simulação manual permanece recolhida. Não altera orçamento/situação da campanha nem soma os valores aos custos. Product Ads automático continua pendente. Ver [campanhas e diagnóstico](intelligence.md).

**Power BI:** exportações CSV/JSON/Excel e URL HTTPS opcional. Refresh automático exige pipeline com autenticação própria. A primeira extensão DATAMAT e o endpoint de processamento agendado foram implementados. IA, tendências, testes A/B e pipeline BI continuam pendentes.

## Conteúdo e competição

Fotos/atributos/variações/estoque/qualidade/vídeo legado retornados pelo ML compõem o retrato oficial e sua trilha de mudanças. Consulta opcional de catálogo usa `price_to_win` e não altera preços. Lotes periódicos enquanto o site está visível complementam notificações; edição/diálogos e aba em segundo plano pausam a atualização visual. Clips e Product Ads exigem integração específica. [Detalhes](intelligence.md).

Catálogo, contagens, indicadores operacionais, galeria e uploads em rascunho: [fotos e vídeos](listing-media.md).

## Google Drive por loja

Configuração e autorização ficam em **Configurações → Integrações**, sem credenciais Google nas variáveis da Vercel. Cadastre Client ID, segredo OAuth e nome da pasta. A URI na publicação é `https://datamat-ml.vercel.app/api/google-drive/callback`. Ative a Drive API e configure o cliente Web/tela de consentimento no Google Cloud. O refresh token é recebido automaticamente no consentimento offline e preservado quando o Google o omite na renovação.

O fluxo usa PKCE, estado com expiração de dez minutos e uso único, cookie HttpOnly ligado ao navegador, versão da configuração e segredo/token criptografados. A autorização abre outra janela e comunica resultado à tela original sem recarregá-la. Identidade Google validada serve para manter os rascunhos na mesma conta; não cria login no sistema.

A pasta privada é criada pelo aplicativo com escopo `drive.file`; a integração não precisa de acesso irrestrito a todos os arquivos pessoais. Veja os limites de arquivos e o procedimento em [listing-media.md](listing-media.md).

## Confirmações e tarifas

Confirmações de exclusão, operações ML e descarte usam diálogos do site com foco contido, Escape/cancelar e opção explícita de continuar. Edições não salvas são protegidas ao fechar formulários ou sair por navegação/voltar. Fechar a aba ou recarregar a página exige o aviso nativo do navegador (`beforeunload`); navegadores não permitem substituí-lo por diálogo personalizado.

A tarifa aceita resposta individual e lista da API ML, conferindo os componentes contra o total. Erros 429 indicam limitação temporária, preservam a conexão/filtros e suspendem novas consultas automáticas por um minuto. A precificação local continua imediata. Cotações válidas são reutilizadas no mesmo cenário durante os cinco minutos de validade; não são reaproveitadas em preço/versão diferentes, nem após solicitar nova consulta.
