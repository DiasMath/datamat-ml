# Extensão DATAMAT 0.1

Primeira versão própria para Chrome Manifest V3: painel lateral, simulação ao digitar com o mesmo motor financeiro do site e captura assistida de ofertas individuais públicas do Mercado Livre brasileiro. Não publica anúncios, não aplica preços e não coleta dados privados de concorrentes. Páginas de catálogo sem oferta individual identificável permanecem sem captura.

Execute `npm run extension:build` na raiz do repositório. O download instalável é `public/datamat-extension.zip`; extraia antes de carregar a pasta em `chrome://extensions` com o modo do desenvolvedor ativado. O diretório de fontes `extension/` não é o pacote instalável.

Abra o painel pelo ícone da extensão, clique em **Parear pelo site**, escolha a loja e gere o código. Cole o código no painel. O acesso expira em 30 dias e pode ser revogado em Configurações → Extensão. O código dá acesso aos custos da loja escolhida: use apenas em seu navegador. Segredos Firebase e Mercado Livre nunca entram no pacote ou no script que lê a página.

A captura lê somente a aba selecionada, após clique do operador, sem coleta recorrente ou chamadas às APIs de terceiros. Até 25 resultados suportados por captura; campos não identificados exigem preenchimento. Confira vendedor, produto, quantidade, frete e preço antes de salvar. Nenhum histórico anterior à primeira observação é criado.

Escopo de paridade com Avantpro Free/Pro ainda não fechado. Editor de imagens, IA, publicação, tendências e testes de anúncios não fazem parte desta primeira versão. A API usa token de dispositivo limitado à loja e à origem da extensão, sem CORS aberto. A identidade principal do site continua aguardando o contrato do portal existente.
