# Pesquisa de mercado pela integração existente

O backend consulta somente recursos previstos da API oficial. Usa a conexão protegida da loja selecionada, renova credenciais pelo mecanismo existente e não retorna tokens, segredos, respostas brutas ou dados pessoais da conta. Não altera anúncios, preços, estoque ou pedidos.

## Verificar acesso no servidor publicado

Após publicar esta versão, faça uma operação a partir da origem configurada em `APP_URL`, selecionando uma loja autorizada e o APP ID esperado:

```js
const result = await fetch("/api/market-research/diagnostic", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ storeId: "SUA_LOJA", applicationId: "SEU_APP_ID" }),
}).then((response) => response.json());
console.log(result);
```

A operação compara `GET /sites/MLB` sem autenticação com `GET /users/me` autenticado. Informa horários, status HTTP, formato da resposta, códigos conhecidos e IDs de correlação disponíveis. A identidade é confirmada por comparação com a conta conectada; o perfil nunca é retornado. Se a própria conta responder corretamente, ainda será necessário confirmar o acesso a recursos de mercado. Um 403 em HTML não identifica sozinho a causa da recusa nem comprova falta de escopo.

## Consultar um recurso de mercado

`POST /api/market-research/read` aceita `{ storeId, applicationId, resource }`. Tipos de recurso:

| Tipo       | Parâmetros                         | Recurso oficial                         |
| ---------- | ---------------------------------- | --------------------------------------- |
| `discover` | `query`                            | Descoberta de categorias MLB, limite 3  |
| `item`     | `id`                               | Anúncio MLB                             |
| `product`  | `id`                               | Produto de catálogo MLB                 |
| `category` | `id`                               | Categoria MLB                           |
| `ranking`  | `category_id`, `brand_id` opcional | Mais vendidos da categoria/filtro BRAND |

O cliente não pode fornecer URLs, caminhos arbitrários, vendedor, credenciais ou operações de escrita. As duas rotas exigem administrador, loja acessível, conexão ativa com a aplicação esperada e a validação de origem já usada no aplicativo. A restrição da aplicação a operadores depende da proteção da hospedagem/portal existente; não há login próprio nesta versão. Não exponha as rotas privadas da aplicação a visitantes anônimos.

Há uma reserva Firestore por conexão para impedir chamadas simultâneas entre processos e servidores. O intervalo entre operações é de pelo menos dois segundos. Falhas que impedem a leitura impõem pausa de pelo menos 60 segundos; não há repetição automática de um 403. Uma reserva interrompida expira após 90 segundos. Essa escrita interna preserva o controle da coleta; não altera os dados comerciais.

## Coleta com checkpoint

Copie `config/market-research.example.json` para um arquivo local, preencha o APP ID e os anúncios realmente identificados. O exemplo público não contém resultados ou uma lista de candidatos do usuário. Depois da publicação:

```sh
npm run research:ml -- --config data/market-config.json --backend https://SEU_DATAMAT --out data/market-research/D0
```

Para retomar o mesmo snapshot após resolver uma interrupção:

```sh
npm run research:ml -- --config data/market-config.json --backend https://SEU_DATAMAT --out data/market-research/D0 --resume
```

Sem `--backend`, o coletor usa a identidade administrativa já configurada no ambiente local. Com `--backend`, nenhum token ou credencial Firebase precisa sair do servidor. Mantenha o proxy e a validação TLS do ambiente. Node 24 pode usar `NODE_USE_ENV_PROXY=1 NODE_USE_SYSTEM_CA=1` quando houver proxy configurado.

O coletor salva `checkpoint.json`, `observations.jsonl`, `observations.csv` e `summary.json` após cada resultado. Limita a fila a 200 recursos no exemplo, tem prazo de 45 segundos por operação e evita duas execuções no mesmo snapshot. Ctrl+C preserva o progresso. Saída 0 indica fila concluída dentro do limite; 2 indica pausa com checkpoint; 1 indica configuração ou outra falha. Se `resource_limit_reached` for verdadeiro, houve descobertas que não entraram na fila. Dados ficam no diretório local ignorado pelo Git.

Um 404 significa indisponível, nunca zero vendas. Valores ausentes permanecem nulos/em branco. `sold_quantity_returned` conserva apenas um número realmente retornado; a exatidão e a janela temporal não são presumidas. Não atribua o contador do anúncio às cores/variações. Vendas em 7 e 30 dias permanecem desconhecidas. Rankings informam posições de ITEM, PRODUCT ou USER_PRODUCT, não volumes mensais; USER_PRODUCT não é consultado como anúncio.

O coletor confirma categorias finais antes de enfileirar rankings e só monta filtros de marca com IDs observados em atributos da marca desejada. Descoberta por texto sugere classificação, não demanda. Ranking sem filtro pode conter outras marcas. Antes de associar anúncio a SKU, confira código, amperagem, kit/unidade, funcionamento e variante. D7/D30 exigem novos diretórios e observações; `--resume` apenas completa o snapshot existente.

Documentação oficial: [autorização](https://developers.mercadolivre.com.br/autenticacao-e-autorizacao), [erro 403](https://developers.mercadolivre.com.br/pt_br/guia-para-produtos/erro-403), [mais vendidos](https://developers.mercadolivre.com.br/pt_br/gerenciamento-perguntas-respostas/mais-vendidos-no-mercado-livre).
