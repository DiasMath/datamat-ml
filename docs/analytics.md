# Análises e operação ao vivo

O menu **Análises** reúne oito áreas. Conecte as lojas em Configurações → Integrações, sincronize os anúncios e use **Atualizar ML**. Selecione uma loja específica para não incluir contas ainda desconectadas no comparativo. O favicon SVG é o logotipo enviado pelo responsável.

| Área        | Indicadores e decisões                                                                                                 |
| ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| Visão geral | Receita bruta, pedidos pagos, unidades, ticket, comparação com período anterior, próximos ajustes e saúde da operação  |
| Vendas      | Série diária, horários de venda, cancelamentos, outras situações de pedido e comparativo entre lojas                   |
| Produtos    | Ranking por receita, unidades e contribuição estimada, participação na receita e acesso ao cadastro vinculado          |
| Tráfego     | Visitas por dia, razão pedidos/visitas e unidades por pedido, sem atribuição individual de visitantes                  |
| Financeiro  | Receita, tarifa por item retornada no pedido, cobertura das tarifas e contribuição estimada com custos atuais          |
| Operação    | Perguntas sem resposta, estoque publicado, custos pendentes, qualidade, ações em atraso, reputação e amostra de envios |
| Publicidade | Relatórios salvos/importados por campanha, ROAS/ACOS/CTR/CPC/CPO, contribuição e tarefas; simulação ao digitar         |

| Diagnóstico | Crescimento/queda por anúncio, margem, qualidade oficial e próximos ajustes, com amostra e critérios explícitos |

Campanhas, competição no catálogo, mídia, termos de títulos e atualização: [intelligence.md](intelligence.md).

## Períodos e cálculos

Hoje, ontem, 7, 30, 90 dias ou intervalo personalizado de até 90 dias. Datas e horários das vendas seguem `America/Sao_Paulo`; a integração atual é para vendedores brasileiros. Pedidos são selecionados pela data de criação e status atual. A comparação utiliza o intervalo imediatamente anterior com a mesma duração e horário de corte: hoje às 12h é comparado com ontem até 12h. Em períodos que incluem hoje, a comparação mantém a mesma duração total.

Receita bruta = soma de preço unitário × quantidade dos itens dos pedidos atualmente pagos. Não inclui frete cobrado do comprador. Um pedido com múltiplos itens conta uma vez no total; pedidos de um mesmo carrinho não são fundidos. IDs são deduplicados por loja. Cancelamento = pedidos atualmente cancelados ÷ todos os pedidos consultados criados no período; não é a métrica de reputação do ML. Receita paga pode mudar quando um pedido é cancelado posteriormente.

Tarifas = `sale_fee` por unidade × quantidade, apenas quando esse campo é fornecido. A contribuição usa preço efetivamente vendido, custos atuais completos e parâmetros atuais do cadastro. Custos vencidos, variações sem preço uniforme e anúncios sem vínculo com a conta autorizada são excluídos da estimativa. Cobertura é a parcela de receita com valores conhecidos; contribuição parcial não vira lucro total. Não há conciliação de repasses nem custo histórico por venda.

As recomendações são regras transparentes: queda de receita maior que 15%, cancelamentos maiores que 5%, concentração de pelo menos 40% em um anúncio e prioridades existentes de margem, qualidade e custo. As regras de vendas exigem cobertura completa; são alertas de investigação, não decisões automáticas. O alerta de estoque publicado usa 1 a 3 unidades, sem prever demanda.

## Tela ao vivo

**Análise ao vivo** abre `/analises/ao-vivo` com receita, pedidos, unidades, ticket, receita/pedidos por hora, últimos 20 pedidos pagos e prioridades. Consulta o ML ao entrar e a cada 60 segundos após concluir a atualização anterior. Pausa em segundo plano; há botões Pausar/Retomar e Tela cheia. Mostra a data da última consulta e possíveis atrasos da API. Não é um stream de eventos nem uma promessa de atualização instantânea.

O cache do Firestore e uma reserva por conexão evitam consultas simultâneas e consultas repetidas em menos de 45 segundos. Requisições antigas são descartadas no navegador quando a loja/período muda. Erros preservam o último retrato, marcam o relatório e suspendem as comparações. A consulta GET lê o retrato disponível; POST `/api/analytics/refresh` exige origem autorizada e permissão de escrita.

## Integração, cobertura e privacidade

APIs utilizadas: `/orders/search`, `/users/{seller_id}`, `/questions/search`, `/users/{seller_id}/items_visits` e `/shipments/{shipment_id}`. As mesmas regras de autorização, criptografia, renovação de tokens e prazo das consultas da integração ML existente são reutilizadas. A identidade do vendedor vem da conexão no servidor, nunca do navegador. Troca de conta ou versão de autorização invalida o uso do retrato anterior.

Até 1.000 pedidos por loja por consulta, contando o período e a comparação; a tela informa quando deve ser reduzido o intervalo. Retratos maiores que o limite de armazenamento também são identificados como parciais. Dados opcionais indisponíveis permanecem indisponíveis; não viram zero. Visitas só são aceitas se todos os dias solicitados aparecem uma vez na resposta; a API pode processar visitas com atraso. Não há ranking automático de conversão por anúncio nesta versão.

Logística consulta até 20 envios únicos recentes de pedidos pagos do período; o relatório mostra quantos foram consultados e o total identificado. Reputação mantém a janela própria informada pelo ML. Ausência de acesso a esses recursos não bloqueia as vendas. Nomes, e-mails, endereços e dados do comprador não são enviados ao navegador nem persistidos no retrato; são mantidos apenas IDs de pedidos e indicadores comerciais necessários. Tokens continuam criptografados somente no servidor.

Os retratos ficam em `ml_analytics` e as reservas em `ml_analytics_locks`. `firestore.indexes.json` exclui o JSON do retrato da indexação. As regras Firestore continuam bloqueando o acesso direto do navegador. O ranking tem paginação e rolagem limitada; o gráfico tem pontos acessíveis por teclado, tabela alternativa e exportação CSV compatível com Excel. Nenhuma biblioteca adicional de gráficos foi instalada.

## O que ainda depende de outra integração

Product Ads automático, reclamações e devoluções detalhadas, conciliação de pagamentos, promoções/subsídios, competição e métricas de catálogo precisam de módulos/API e permissões específicos. Não são substituídos por métricas fictícias. O cálculo manual de publicidade permite usar o relatório real do ML enquanto a integração específica não existe.

As páginas oficiais de desenvolvedores sobre vendas, visitas, reputação e Product Ads retornaram HTTP 403 para a consulta automatizada neste ambiente. A validação usa contratos simulados e emulador Firestore isolado. A coleta real deve ser conferida após autorizar as lojas em produção, especialmente visitas e permissões opcionais. Referências para conferência: [vendas](https://developers.mercadolivre.com.br/pt_br/gerenciamento-de-vendas), [visitas](https://developers.mercadolivre.com.br/pt_br/visitas), [reputação](https://developers.mercadolivre.com.br/pt_br/reputacao-de-vendedores), [Product Ads](https://developers.mercadolivre.com.br/pt_br/product-ads).
