# Integrações e situação real

## Mercado Livre implementado no código

OAuth por loja com `state` de uso único, expiração de dez minutos, cookie HttpOnly SameSite=Lax e PKCE S256. A troca/renovação ocorre no servidor; tokens e verificador são protegidos com AES-256-GCM em coleções privadas do Firestore. Renovações concorrentes usam bloqueio temporário. O vendedor retornado por `/users/me` deve corresponder ao token, pertencer ao Brasil e não ocupar outra loja. Desconectar invalida autorizações/consultas em andamento e preserva os registros operacionais.

**A aplicação não está conectada às contas reais.** Faltam publicação HTTPS, ID/segredo da aplicação, redirect cadastrado e autorização dos vendedores. O fluxo básico de OAuth foi conferido no [SDK oficial Mercado Libre](https://github.com/mercadolibre/nodejs-sdk), incluindo host brasileiro e `/oauth/token`. A documentação/API oficial retornou **HTTP 403** nas consultas deste ambiente. Os contratos de anúncios, tarifas e métricas têm validação estrita e testes com respostas simuladas, e precisam ser exercitados na aplicação autorizada. Não foram consultados anúncios privados de vendedores nem aplicados preços reais.

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
| Notificações            | Endpoint recebe `items`, `orders_v2`, `questions`, valida app/recurso e deduplica metadados em caixa de até 100 recursos recentes. Retorna 202. Payloads são sinais não verificados; não atualizam registros financeiros. A interface inicia a consulta oficial, sem worker automático nesta etapa.                                                                                    |

O limite de execução preserva checkpoints antes de atingir o limite da função Vercel. Requisições de leitura elegíveis podem repetir 429/5xx de forma limitada; a troca de token e o scan não são repetidos cegamente. Falhas retornam mensagens sanitizadas, sem tokens, códigos OAuth, segredo ou dados de compradores.

**Frete, promoções e subsídios:** não são inferidos da tarifa de venda. O cenário continua exigindo conferência de frete e condições adicionais. Mínimo, preço desejado e desconto máximo extrapolam custos/tarifas constantes; são estimativas que precisam de nova consulta para outro preço. Tarifas consultadas entram no cenário/proposta, sem gravar custos ou preço atual a cada tecla. Não há escrita de preço, conteúdo ou estoque no ML; a execução continua no ML/Bling e a confirmação manual fica no histórico.

Ativação e URLs: [Publicar na Vercel](vercel.md).

## Responsabilidade por campo

| Campo                               | Responsável                         | Direção                                                                                            |
| ----------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------- |
| Produto, SKU e estoque              | ERP / ML conforme configuração real | Leitura no DATAMAT; sem escrita de estoque                                                         |
| Preço e conteúdo publicados         | ML, cliente e ERP configurado       | Observação ML → DATAMAT; proposta → aprovação → execução externa → confirmação                     |
| Tarifas e restrições                | Mercado Livre                       | Consulta por preço/categoria/modalidade; frete e promoções ainda precisam de integração específica |
| Custos, parâmetros, tarefas e notas | DATAMAT                             | Cadastro validado e histórico preservado                                                           |
| Análises aprofundadas               | Power BI                            | Exportação autorizada → BI                                                                         |

Não ativar dois escritores sobre preço/estoque/conteúdo. A integração Bling e a aplicação automática de propostas dependem de definir a autoridade por campo.

## Demais integrações

**Bling:** permanece pendente. Variáveis presentes não significam conta autorizada. Faltam OAuth, adapter de leitura, vínculos de produtos e responsabilidade por campo. Ver https://developer.bling.com.br/.

**IA:** permanece pendente. Checklist e prioridades atuais são regras determinísticas. Não enviam dados a um provedor de IA, nem criam características técnicas presumidas ou alegações de causalidade.

**Publicidade:** calculadora manual de ROAS, ACOS e TACOS ao digitar, usando dados do mesmo período. Os valores servem para análise; não são somados aos custos automaticamente. API de Ads, custo atribuído por pedido e orçamento sustentável continuam no roadmap.

**Power BI:** exportações CSV/JSON/Excel e URL HTTPS opcional. Refresh automático exige pipeline com autenticação própria. A extensão DATAMAT, IA, tendências, testes A/B e processamento agendado continuam nas etapas posteriores.
