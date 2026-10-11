# Publicação na Vercel

O projeto está preparado para Next.js na Vercel. `vercel.json` usa `npm ci`, `npm run build`, região São Paulo (`gru1`) e limite de 300 segundos para as APIs. A persistência é Firestore; não há dependência de SQLite, disco persistente, Java ou emulador em produção. Segredos e artefatos locais são excluídos pelo `.vercelignore` e `.gitignore`.

## Primeiro deploy

1. Enviar o código revisado ao repositório `DiasMath/datamat-ml` e importar esse repositório em **Vercel → Add New → Project**. A raiz é a pasta que contém `package.json`, sem o prefixo `/workspace`. Framework: **Next.js**; Node.js: **24.x**. Não definir Output Directory manualmente.
2. Em **Settings → Environment Variables**, cadastrar os valores abaixo para **Production**. O JSON administrativo fica como variável sensível; não usar `NEXT_PUBLIC_` para qualquer segredo.
3. Fazer o deploy. A inicialização idempotente ocorre na primeira chamada da API e preserva a organização e as lojas existentes; não é necessário executar uma migração que limpe dados.
4. Copiar a URL de produção gerada pela Vercel, preferencialmente o domínio estável do projeto. Atualizar `APP_URL` com essa origem HTTPS e fazer **Redeploy** para aplicar o valor. O nome do domínio ainda não foi criado ou reservado neste trabalho.
5. Abrir Configurações → Lojas e parâmetros, conferir as lojas, cadastrar um rascunho próprio e testar o fluxo operacional. A URL de produção é a origem permitida para gravações; abrir outro domínio/preview sem configurar sua origem retorna 403.

| Variável                         | Valor / finalidade                                                                                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FIREBASE_PROJECT_ID`            | `datamat-ml`                                                                                                                                                                     |
| `FIREBASE_SERVICE_ACCOUNT_EMAIL` | `firebase-adminsdk-fbsvc@datamat-ml.iam.gserviceaccount.com`                                                                                                                     |
| `FIREBASE_SERVICE_ACCOUNT_JSON`  | Conteúdo integral do JSON administrativo fornecido, como segredo no servidor. O campo `private_key` mantém seus `\n` dentro do JSON.                                             |
| `APP_URL`                        | Origem HTTPS da publicação, por exemplo `https://<dominio-gerado>.vercel.app`, sem caminho.                                                                                      |
| `APP_OPERATOR_NAME`              | Nome do responsável único usado no histórico.                                                                                                                                    |
| `ML_CLIENT_ID`                   | ID da aplicação Mercado Livre. Pode ser configurado após o primeiro deploy.                                                                                                      |
| `ML_CLIENT_SECRET`               | Segredo da aplicação ML, variável sensível.                                                                                                                                      |
| `ML_REDIRECT_URI`                | Mesma origem de `APP_URL`, com `/api/mercadolivre/callback`.                                                                                                                     |
| `ML_TOKEN_ENCRYPTION_KEY`        | Chave base64 de 32 bytes para AES-256-GCM. Criada localmente em `.env.local`, com permissões restritas, sem exibir o valor. Guardar a chave; mudá-la exige reconectar as contas. |

O caminho `FIREBASE_ADMIN_CREDENTIALS_PATH` deste ambiente não existe na Vercel. Usar o JSON secreto em vez do caminho local. Não configurar `FIRESTORE_EMULATOR_HOST` em produção. Variáveis web públicas do Firebase são opcionais nesta versão: o navegador utiliza a API do sistema, sem acesso direto ao Firestore.

O validador `npm run vercel:check` verifica as variáveis de produção sem imprimir valores. Execute-o em um ambiente que tenha recebido essas variáveis; uma configuração local com `localhost` e caminho de arquivo será rejeitada para publicação.

O código exige o contexto do portal ou proteção de acesso da hospedagem para restringir operadores quando colocado na internet. Não há login próprio nem validação de sessão do portal nesta versão; qualquer visitante com acesso à aplicação assume o responsável único. A proteção da hospedagem deve permitir a chamada de notificações do ML ao endpoint público correspondente, sem abrir as demais operações privadas.

## URLs para cadastrar na aplicação Mercado Livre

Após obter a URL estável real da Vercel, substituir o domínio nas duas URLs:

- **URIs de redirect:** `https://<dominio-real>/api/mercadolivre/callback`
- **URL de retornos de chamada de notificação:** `https://<dominio-real>/api/mercadolivre/notifications`

Não cadastrar os placeholders literalmente. Não usar `localhost`, URL temporária de uma execução cloud ou domínio de preview que muda a cada commit. O redirect deve ser exatamente igual a `ML_REDIRECT_URI`. Cadastrar os tópicos suportados **items**, **orders_v2** e **questions** quando a aplicação oferecer essa escolha; habilitar as permissões de leitura necessárias e renovação de acesso conforme o portal ML.

Com as quatro variáveis ML configuradas, fazer Redeploy e usar **Configurações → Integrações → Conectar conta ML** em cada loja. Autorizar `juntos.com` na loja correspondente e depois `juntos.data`; o mesmo vendedor não pode ocupar duas lojas. O site não pede nem armazena a senha do Mercado Livre. Em seguida, sincronizar o catálogo e continuar os lotes de 20 até concluir a consulta.

As notificações são recebidas com resposta 202, validação de aplicação/recurso e deduplicação em caixa limitada. São sinais para consultar novamente os dados, não instruções para alterar preço ou estoque. Nesta etapa não há worker/cron que processe essa caixa automaticamente; a consulta é iniciada na interface.

## Verificações antes e depois

Antes: `npm run typecheck`, `npm test`, `npm run build` e `npm run test:e2e`. O emulador e Chromium são ferramentas de teste; não entram na aplicação publicada.

Depois: consultar `/api/workspace`, conferir ausência de erros da credencial, testar uma gravação própria a partir do domínio de produção e finalizar o OAuth pelo botão da loja. A integração real precisa validar os contratos/permissões da aplicação ML: as APIs/documentação oficiais retornaram 403 neste ambiente, e os testes de integração foram feitos com respostas simuladas controladas. O SDK oficial foi consultado para o fluxo OAuth.

O deploy não foi executado e nenhuma conta Vercel foi vinculada automaticamente. Não foram criadas URLs públicas, aplicações ML ou autorizações de vendedor fictícias. Previews devem usar credenciais e projeto Firestore de teste separados; não replicar os segredos de produção para branches de teste.
