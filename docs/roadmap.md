# Pendências para conclusão

**Login removido.** O site abre diretamente, sem cadastro inicial, senhas locais ou saída própria. O contexto atual usa um responsável único definido no servidor. A identidade individual e permissões do portal existente ainda precisam ser conectadas.

## Precificação — melhoria solicitada em 22/10/2026

Implementado após a correção da sincronização:

- Cadastrar o custo unitário de compra do fornecedor no produto e utilizá-lo como base dos anúncios vinculados. Definir herança e exceções por anúncio, preservando custos já preenchidos, composições de kits e histórico das propostas.
- Calcular a margem sobre o preço de venda: `(venda − custo de compra − demais custos) ÷ venda × 100`, com meta **acima de 40%**. Essa porcentagem é margem sobre a venda, não acréscimo sobre o custo. Manter o recálculo ao digitar.
- Considerar as tarifas próprias de **Clássico e Premium**, parcelas fixas/percentuais aplicáveis e o custo do vendedor no frete, com ou sem frete grátis. Campanhas, publicidade e promoções são componentes separados e não representam todos os custos do ML.
- Incluir também os demais custos próprios e impostos aplicáveis. Custo desconhecido continua pendente, sem ser convertido em zero. Confirmar fontes e validade dos custos automáticos antes de apresentar a margem como calculável.
- Disponibilizar o custo de compra em cadastro, edição e importação/exportação Excel. Alterações devem atualizar os cálculos e exigir revisão das propostas afetadas sem reescrever seus retratos históricos.

O produto agora tem custo de compra unitário. Mercadoria vazia no anúncio herda esse custo; um valor específico, inclusive zero, permanece como exceção. Kits somam quantidades dos componentes. Variações com custos diferentes permanecem pendentes até a precificação individual. Alterações versionam todos os anúncios vinculados, incluindo composições, e preservam os snapshots históricos.

A margem sobre o preço de venda tem meta padrão estritamente acima de 40%. Por padrão, aprovação e aplicação são bloqueadas quando a meta não é atingida; em Configurações → Editar parâmetros da loja, é possível alterar a meta ou desativar o bloqueio e manter somente os alertas e o preço sugerido. Rascunhos continuam permitidos. O preço sugerido é uma estimativa com custos constantes e sem subsídio promocional; a tarifa e o frete devem ser reconsultados para o novo preço.

Na exportação Excel, a aba Produtos contém uma linha por produto, com productId, productVersion e purchaseCost. Para editar esses custos, importe essa aba com a operação Atualizar custos de produtos. A aba Anúncios mantém o custo como referência; novos cadastros também aceitam purchaseCost. Versões desatualizadas, produtos duplicados, lojas sem acesso e aplicações ML em andamento são rejeitados antes da gravação. A importação não altera custos específicos de anúncios nem publica preços no ML.

Tarifas Clássico/Premium seguem a modalidade real do anúncio e as consultas oficiais, com parcela percentual e fixa separadas. Frete desconhecido continua pendente, inclusive sem gratuidade para o comprador. O sistema não presume tarifas de uma modalidade diferente nem custo zero de frete. Publicidade, promoções, embalagem, impostos e outros custos seguem separados.

## Cadastro do produto e termos da interface — 22/10/2026

Preço de custo é um dado do produto, armazenado no documento products e editável por /api/products/:id. O bloco Cadastro do produto mostra esse valor diretamente na visão geral do anúncio, na prévia lateral e antes do simulador de preços, com botão Editar produto e formulário próprio. Não depende de promoção, proposta, modalidade Clássico/Premium ou condição de frete. No cadastro do anúncio, Preço de custo (R$) fica sempre visível, inclusive para produtos existentes, sem marcar a edição dos demais dados do produto. Versões, auditoria, autorização das lojas vinculadas e proteção de aplicações ML em andamento são compartilhadas com o fluxo já existente.

A interface usa anúncio para o cadastro e suas condições, com Identificação do anúncio na visão geral. Clássico/Premium aparecem como modalidades e o frete como condição do anúncio. Promoções e publicidade continuam separadas do preço de custo do produto. Uma exceção de mercadoria no anúncio permanece explícita e preservada.

## Sincronização contínua e buscas — 22/10/2026

- Um clique em Sincronizar anúncios nas integrações percorre todas as páginas da loja do cartão, com progresso visível. A tela de Anúncios e o painel global usam a mesma continuação. Os lotes de 20 continuam sendo uma unidade interna da API, sem exigir um clique por lote.
- Uma requisição por vez, intervalo entre etapas, espera conforme Retry-After do ML, retomada da página salva e tentativas limitadas para falhas temporárias. Métricas/tarifas reconsultam apenas as partes incompletas após um 429. Falhas persistentes e quota do Firestore não viram loops infinitos nem sucesso falso. A execução ocorre enquanto a página está aberta; a posição salva permite retomar após interrupção.
- Anúncios: busca ao digitar com debounce de 250 ms, colagem imediata e filtros preservados, usando o cadastro já carregado. Não há nova consulta ao Firestore por tecla. A busca aceita acentos, termos em qualquer ordem, SKU/modelo/código ML e URLs de anúncios coladas. Exportações usam a mesma regra de busca.
- Precificação: campo de busca por produto, título, SKU, modelo ou código ML, com escolha explícita do anúncio. A busca e a troca da oferta não recarregam o cadastro completo.

## Já entregue nesta revisão

- Rolagem limitada e paginação de 20/50/100 para anúncios, ações, notas, histórico, registros e prévia de importação.
- Menos consultas repetidas ao paginar, ordenar, alternar abas e abrir/fechar fichas.
- Excel .xlsx e CSV: arquivos de até 1.000 linhas, mapeamento, seleção de aba, prévia, cadastro e atualização por ID/versão.
- Exportação Excel de todo o conjunto filtrado; modelo vazio; custos e histórico preservados nas atualizações.
- Lotes de até 40, retomada e proteção contra reenvio duplicado.
- Cálculos ao digitar, prévia de custos não salvos, propostas com custos previstos e autocomplete de campos recorrentes.
- OAuth ML por loja, proteção/renovação dos tokens, importação em lotes, consulta de tarifas por preço, métricas por período e notificações, testados com respostas controladas; ativação real pendente.
- Checklist que vira tarefa, prioridades operacionais explicáveis, indicadores de publicidade manuais e configuração de publicação na Vercel.
- Pesquisa de ML, Real Trends, Nubimetrics, Avantpro e Bling com [prioridades por módulo](research-mercado-livre.md).
- Pesquisa pública do Avantpro e [referência e extensão implementada](avantpro.md), com limitações da comparação Free/Pro registradas.

## Ordem de conclusão

| Prioridade | Entrega               | Critério de conclusão                                                                                                                                                                  |
| ---------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1          | Contexto do portal    | Identidade verificada pelo servidor, organização, lojas e papéis; responsável/aprovador individual no histórico. Definir rota, módulo ou iframe e o contrato de sessão correspondente  |
| 2          | Mercado Livre         | Ativar e validar OAuth/importação/tarifas/métricas nas duas contas reais; completar variações individuais, frete, promoções e escrita após aprovação                                   |
| 3          | Bling                 | OAuth, correspondências de produtos/ofertas e definição de quem controla preço, estoque e conteúdo; evitar sobrescritas concorrentes                                                   |
| 4          | Dados e escala        | Atualização agendada/eventos, renovação de tokens, falhas controladas, busca indexada, paginação por cursor e agregações no Firestore. Medir leituras, duração e custo com volume real |
| 5          | Publicação e operação | HTTPS, domínio, segredos, contexto de acesso do portal, backup e restauração verificada; validação do fluxo com dados reais. Power BI automático exige pipeline próprio                |
| 6          | Extensão DATAMAT      | Captura, concorrência, histórico observado e acompanhamento integrados ao site; expandir segundo a matriz Avantpro, com APIs/fontes confirmadas                                        |
| 7          | Recursos avançados    | IA, tendências, testes A/B, imagens e publicador: somente após fluxo principal e dados confiáveis; sugestões sempre revisáveis                                                         |

## O que falta para iniciar a rotina manual

Conferir dados financeiros, cadastrar/importar anúncios reais e integrar/publicar pelo portal. A versão atual permite gestão manual no ambiente existente: cadastro, edição/exclusão permitida, custos, simulação, proposta, aprovação, confirmação, ações, notas e histórico. Preço de anúncio individual elegível pode ser aplicado por API após aprovação; demais alterações ML/Bling continuam externas com confirmação manual.

Para concluir a rotina conectada, faltam a ativação/validação real do ML, frete/promoções, escrita de conteúdo/estoque e variações, Bling e expansão da extensão. O Excel não substitui sincronização. A paginação visual não limita a leitura inicial do banco; bases grandes exigem consultas por cursor.

Dados necessários: anúncios/SKUs reais, custos/impostos/margens e base da comissão, aplicações/autorização ML e Bling, contrato do portal e eventual relatório/pipeline BI. Ver [review.md](review.md), [validation.md](validation.md) e [integrations.md](integrations.md).

A preparação da Vercel está documentada em [vercel.md](vercel.md). O recebimento de notificações inclui processamento verificado em segundo plano; cron diário exige CRON_SECRET compartilhada; o processamento grande de pedidos, publicidade por API, conciliação e preços individuais de variação permanecem pendentes.

## Rotina integrada entregue

Skeletons, toasts com relógio único, Hoje com vendas/margens/estoque/tarefas, processamento de notificações, aplicação de preço aprovado com conferência e concorrência com primeira extensão própria. Ver [fontes e limites](daily-operation.md).

## Tabelas e ações em lote entregues

Ordenação por cabeçalho, largura ajustável/restaurável, edição local e exclusão elegível em lote e ativação/pausa de anúncios próprios por API com conferência. Inserção continua pelo Excel. Publicar novos anúncios, enviar conteúdo/estoque e excluir anúncios reais por API permanecem pendentes. Ver [tabelas e operações em lote](tables-and-bulk.md).

## Diagnóstico e interface compacta entregues

Topo menor, opções de dropdown estilizadas com comportamento nativo e fallback, campanhas registradas/importadas com análise e tarefas, crescimento/queda de anúncios, competição opcional do catálogo, análise de termos/rascunhos e retrato de mídia/ficha atualizado. Product Ads automático, todos os Clips, causalidade/experimentos, ranking e publicação/IA/editor permanecem no roteiro descrito em [intelligence.md](intelligence.md) e [avantpro.md](avantpro.md).
