# Rotina conectada e extensão DATAMAT

## Hoje e carregamento

Com uma conta ML autorizada, Hoje mostra receita de produtos de pedidos pagos, pedidos, contribuição estimada e pedidos com margem baixa. Os indicadores locais existentes ficam compactos. Pendências, tabela financeira e reposição começam recolhidas; tabelas têm rolagem e paginação de 20/50/100.

A tela consulta a cada 60 segundos, pausa em aba oculta e permite pausar/retomar. Atualizações preservam o conteúdo carregado. Primeiras consultas usam skeletons com descrição acessível e respeitam movimento reduzido. Toasts usam o mesmo relógio para expiração e barra, inclusive com movimento reduzido, foco, hover e troca da camada do modal.

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
