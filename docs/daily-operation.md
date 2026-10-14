# Rotina conectada e extensão DATAMAT

## Hoje e carregamento

Hoje concentra anúncios, preços e desempenho: quatro indicadores com ícones e cores (receita de produtos vendidos, pedidos pagos/unidades, anúncios urgentes e decisões pendentes), carteira de ativos/pausados/rascunhos, cobertura de custos completos/recentes e atalhos para as respectivas consultas. Ticket médio e contribuição estimada do dia mostram a cobertura da receita calculável; custos desconhecidos não produzem contribuição zero. A fila tem cinco anúncios por página e rolagem interna limitada. O gráfico horário tem preenchimento suave e começa recolhido no celular. Destaques da semana, mudanças observadas no ML e ações em andamento são opcionais, recolhidos e limitados a três registros visíveis.

A fila reúne os motivos do mesmo anúncio em uma linha. **Urgentes** inclui contribuição estimada negativa e estoque publicado zerado, com custos completos/recentes e retrato ML compatível de até 15 minutos; aplicações que exigem conferência também aparecem aqui. **Revisar** inclui margem abaixo da mínima, perda oficial da disputa de catálogo, ausência de fotos, propostas pendentes e queda de receita de pelo menos 30% nos últimos sete dias completos. Essa queda exige consulta completa/compatível, pelo menos três pedidos anteriores e cinco pedidos somados; não atribui uma causa. **Preparar** reúne custos ausentes ou antigos. Anúncio pausado voluntariamente não gera urgência por estar pausado. Dados desconhecidos não viram zero.

Cada anúncio apresenta situação, código ML, preço cadastrado, motivo e evidência útil para agir. Custos incompletos identificam os primeiros campos a preencher. Margem/piso estimados só aparecem com custos recentes; estoque só aparece com retrato ML compatível de até 15 minutos. Ao filtrar decisões, motivo e evidência passam a ser da proposta, mesmo quando o anúncio também tem um problema urgente de margem. As ações levam diretamente à aba relevante da ficha. Voltar à Hoje preserva loja, grupo, página e as posições da tela e da fila. Revisões não urgentes podem ser adiadas por uma hora nesta sessão do navegador; novo motivo/evidência invalida o adiamento. Urgências não podem ser ocultadas dessa forma.

A tela consulta a cada 60 segundos após a conclusão da consulta anterior, pausa em aba oculta e permite pausar/retomar. Formulários/diálogos abertos suspendem a atualização. Falhas preservam conteúdo, filtros e paginação. Primeiras consultas usam skeletons com descrição acessível e respeitam movimento reduzido. Toasts usam o mesmo relógio para expiração e barra, inclusive com movimento reduzido, foco, hover e troca da camada do modal.

O indicador global é somente um spinner no cabeçalho, com espaço reservado e descrição acessível. Não há barra verde nem aviso flutuante de processamento. Hoje mostra o spinner no botão Atualizar ML mantendo seu texto/largura; consultas automáticas da Hoje, catálogo e análises ao vivo não acionam o indicador global. A atualização automática do catálogo também carrega os novos registros sem desabilitar a tela; respostas que chegam durante edição são descartadas. Navegar/trocar de loja cancela as consultas anteriores do workspace para evitar indicadores presos em requisições abandonadas. Gravações continuam protegidas até obter a versão atualizada dos dados.

`GET /api/today` usa projeções do Firestore e devolve somente o relatório necessário; produtos, notas, atributos completos, histórico e snapshots de propostas ficam fora da resposta. O workspace completo é carregado apenas ao abrir um formulário. `POST /api/today/refresh` compartilha a sincronização retomável do catálogo, com orçamento de 55 segundos, mas consulta somente vendas para os indicadores. Não busca perguntas, visitas ou envios para essa tela. O cache de vendas dura 45 segundos; uma consulta completa de Análises não reutiliza esse cache reduzido como se contivesse dados operacionais.

A comparação de receita usa o mesmo horário de Brasília nos dois dias, limitado ao menor horário efetivamente consultado entre as lojas. Consultas parciais ocultam a comparação. Mudanças no ML são as últimas diferenças observadas por anúncio desde esta versão, com data, campos alterados e autorização compatível; não reconstituem alterações anteriores à implantação.

Quando alguma loja selecionada está sem conexão/consulta, o status informa **Vendas de X/Y lojas**. O ícone de informação abre um popover sem deslocar o conteúdo e identifica a situação de cada loja, com acesso às integrações. Uma consulta incompleta do próprio ML mantém **Dados parciais**, com os avisos disponíveis. Essa cobertura se refere às vendas, independentemente dos custos cadastrados. Por exemplo, todas as lojas pode incluir uma conta desconectada; filtrar somente a loja com consulta completa remove essa parcialidade.

## Fontes e limites

- **Contribuição prevista:** preço vendido e custos atuais completos/recentes do cadastro. **Contribuição ajustada:** substitui comissão estimada pela `sale_fee` informada por unidade no pedido. Mercadoria, embalagem, frete, publicidade, impostos e gestão continuam estimados. Não é lucro conciliado nem repasse recebido.
- **Cobertura financeira:** dados ausentes não viram zero. Pedido com alguma linha sem custos/tarifa utilizáveis não apresenta contribuição total; a cobertura informa a receita suficiente. Item negativo ou abaixo da margem mínima gera prioridade revisável.
- **Reposição:** estoque consultado há até 30 minutos e unidades pagas dos últimos sete dias completos, apenas com vendedor/autorização/consulta compatíveis. Sem demanda, retrato antigo ou consulta parcial, não há previsão. Até sete dias de cobertura sugere reposição. Estoque é por anúncio: kits, variações e mercadoria compartilhada precisam de correspondência com ERP.
- **Operação:** perguntas usam a contagem do ML; logística é amostra de até 20 envios recentes por loja. Somente `handling`/`ready_to_ship` com `shipping_option.estimated_handling_limit.date` válido/vencido indica despacho atrasado. Prioridades podem virar tarefas idempotentes em Ações. Resolver a tarefa não responde perguntas nem despacha envios no ML.
- **Volume:** até 1.000 pedidos por loja/janela incluindo comparação. Consulta parcial não sustenta previsão. Paginação visual não substitui consultas por cursor no Firestore para bases grandes.

## Sincronização e agendamento

`POST /api/routine/refresh` tem orçamento de tempo, reserva no Firestore e espera progressiva após falhas (até 15 minutos). Consulta um lote retomável de até 20 anúncios por execução; itens notificados são consultados por ID sem alterar o cursor do catálogo. Retoma lotes pendentes e inicia nova consulta após 15 minutos desde o último lote geral. O retrato de estoque é renovado a cada seis horas/primeira consulta, e vendas usam cache de 45 segundos.

Notificações `items`, `orders_v2`, `questions` retornam 202 e acionam `after()` do Next.js. Recursos são lidos com o token e conferidos contra o vendedor autorizado antes de qualquer atualização. Fila limitada a 100 recursos recentes, deduplicada; sinais de outro vendedor são descartados, falhas temporárias recebem tentativas limitadas sem bloquear vendas. Não existe processo permanente na função: o próximo evento, consulta da tela ou cron retoma a fila.

O cron diário de `vercel.json` chama `/api/routine/scheduled` às **06:00 de Brasília** (09:00 UTC). Configure uma única **CRON_SECRET** aleatória em Production na Vercel e publique novamente para ativá-lo. A rota exige o Bearer correspondente; sem configuração responde 503 e não sincroniza. É infraestrutura compartilhada, não credencial de loja. Webhooks e atualização pela tela não dependem dela. Catálogos grandes exigem mais invocações; um cron diário não é sincronização contínua.

## Aplicação de preço

Proposta aprovada → Aplicar preço no ML → confirmação do operador → nova consulta de preço/tarifa → envio único → leitura de confirmação → Firestore/histórico.

Aceita anúncio próprio individual ativo/pausado, sem catálogo, variações, promoção, subsídio ou mudança de conteúdo. Vendedor, autorização, versão, parâmetros e tarifa atual são conferidos. Edição local, custos, parâmetros e sincronização do anúncio ficam protegidos durante o envio. O PUT não é repetido automaticamente.

Resposta perdida após possível envio gera **Conferência necessária**. **Conferir aplicação no ML** apenas lê, sem reenviar. Funciona também quando um webhook já observou o novo preço e preserva custos editados desde então. Divergência externa exige revisão; confirmação manual permanece para casos não suportados. Testes usam contas/respostas sintéticas e emulador; aplicação numa oferta real ainda requer validação com a conta autorizada.

## Concorrência e extensão

Referências ficam separadas do catálogo próprio: preço, frete informado, vendedor, URL/ID individual correspondente, origem, data, vínculo opcional e limiar percentual. Até 100 mudanças recentes, desde a primeira observação. Alertas podem ser marcados como vistos ou gerar tarefa. Exportação CSV, edição/exclusão com versão e isolamento de lojas. Não há coleta recorrente de concorrentes nem acesso presumido a visitas/vendas privadas.

A primeira extensão é gerada no build e baixada em **Configurações → Extensão**: Chrome Manifest V3, painel lateral, captura assistida da aba e simulação ao digitar com `src/domain/finance.ts`. Até 25 ofertas individuais suportadas; preço desconhecido exige preenchimento. IDs de catálogo não identificam ofertas individuais. Condições externas precisam de conferência.

Parear pelo site → escolher loja → gerar código → colar na extensão. Token aleatório mostrado uma vez, guardado como hash no servidor, vinculado à origem, válido por 30 dias e revogável. Permite consultar ofertas/custos da loja e salvar referências, sem segredos ML/Firebase nem aprovação/envio de preços. O script de captura não recebe o token. O acesso principal ao site ainda aguarda a identidade verificada do portal.

Instalação: [extension/README.md](../extension/README.md). Sem publicação na Chrome Web Store nesta etapa. Paridade completa Avantpro Free/Pro, editor, IA, tendências, publicador, Ads por API, conciliação, variações individuais e ERP continuam pendentes.

## Tabelas e ações em lote

Cabeçalhos ordenam antes de paginar, com ajuste de largura por arraste e restauração por duplo clique. Anúncios permite edição/exclusão local em lote e ativação/pausa real no ML, mediante confirmação e verificação por anúncio. Ver [fluxos, limites e retomada](tables-and-bulk.md).

## Atualização de conteúdo, diagnóstico e campanhas

A ficha registra mudanças em fotos, atributos, variações, estoque, qualidade/subsituação e vídeo legado retornado pela API; esses eventos também entram no histórico. Consulta automática enquanto o site está visível, com rascunhos/diálogos protegidos, e botão para conferir o anúncio. Análises → Diagnóstico separa crescimento, margem e catálogo; Publicidade salva/importa relatórios por campanha com ações úteis. Detalhes e APIs ainda pendentes: [intelligence.md](intelligence.md).
