# Publicação na Vercel

O projeto está preparado para Next.js na Vercel. `vercel.json` usa `npm ci`, `npm run build`, região São Paulo (`gru1`) e limite de 300 segundos para as APIs. A persistência é Firestore; não há dependência de SQLite, disco persistente, Java ou emulador em produção. Segredos e artefatos locais são excluídos pelo `.vercelignore` e `.gitignore`.

## Publicação e configuração

1. Enviar o código revisado ao repositório `DiasMath/datamat-ml` e importar esse repositório em **Vercel → Add New → Project**. A raiz é a pasta que contém `package.json`, sem o prefixo `/workspace`. Framework: **Next.js**; Node.js: **24.x**. Não definir Output Directory manualmente.
2. Em **Settings → Environment Variables**, cadastrar os valores abaixo para **Production**. O JSON administrativo fica como variável sensível; não usar `NEXT_PUBLIC_` para qualquer segredo.
3. Fazer o deploy. A inicialização idempotente ocorre na primeira chamada da API e preserva a organização e as lojas existentes; não é necessário executar uma migração que limpe dados.
4. O endereço de produção informado é `https://datamat-ml.vercel.app`. Definir `APP_URL` exatamente com essa origem e fazer **Redeploy** para aplicar alterações das variáveis. Salvar no painel não altera funções de um deploy já existente.
5. Abrir Configurações → Lojas e parâmetros, conferir as lojas, cadastrar um rascunho próprio e testar o fluxo operacional. A URL de produção é a origem permitida para gravações; abrir outro domínio/preview sem configurar sua origem retorna 403.

| Variável                         | Valor / finalidade                                                                                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FIREBASE_PROJECT_ID`            | `datamat-ml`                                                                                                                                                                     |
| `FIREBASE_SERVICE_ACCOUNT_EMAIL` | Opcional: `firebase-adminsdk-fbsvc@datamat-ml.iam.gserviceaccount.com`. Se informado, precisa corresponder ao `client_email` do JSON.                                            |
| `FIREBASE_SERVICE_ACCOUNT_JSON`  | Conteúdo integral do JSON administrativo fornecido, como segredo no servidor. O campo `private_key` mantém seus `\n` dentro do JSON.                                             |
| `APP_URL`                        | `https://datamat-ml.vercel.app`, sem caminho ou parâmetros.                                                                                                                      |
| `APP_OPERATOR_NAME`              | Opcional: nome do responsável único usado no histórico; padrão `Operador`.                                                                                                       |
| `ML_CLIENT_ID`                   | ID da aplicação Mercado Livre. Pode ser configurado após o primeiro deploy.                                                                                                      |
| `ML_CLIENT_SECRET`               | Segredo da aplicação ML, variável sensível.                                                                                                                                      |
| `ML_REDIRECT_URI`                | Mesma origem de `APP_URL`, com `/api/mercadolivre/callback`.                                                                                                                     |
| `ML_TOKEN_ENCRYPTION_KEY`        | Chave base64 de 32 bytes para AES-256-GCM. Criada localmente em `.env.local`, com permissões restritas, sem exibir o valor. Guardar a chave; mudá-la exige reconectar as contas. |

Para abrir o sistema sem conectar o ML, somente `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT_JSON` e `APP_URL` são obrigatórias. As quatro variáveis `ML_*` são necessárias em conjunto para a conexão; `ML_CLIENT_ID` deve ser um ID numérico positivo. Preserve a chave de criptografia existente: trocá-la impede a leitura dos tokens salvos e exige reconexão.

O caminho `FIREBASE_ADMIN_CREDENTIALS_PATH` deste ambiente não existe na Vercel. Remova essa variável, `GOOGLE_APPLICATION_CREDENTIALS` e `FIRESTORE_EMULATOR_HOST` do painel da hospedagem, caso existam. Na Vercel, o servidor exige o JSON administrativo completo em `FIREBASE_SERVICE_ACCOUNT_JSON`. `VERCEL` é fornecida pela própria plataforma; não cadastrá-la manualmente.

As sete variáveis `NEXT_PUBLIC_FIREBASE_*` são opcionais nesta versão: o navegador utiliza a API do sistema, sem acesso direto ao Firestore. A configuração web `firebaseConfig` não substitui uma conta de serviço. Bling e IA ainda não têm adapters operacionais; deixar suas variáveis vazias não impede os módulos atuais. `POWER_BI_REPORT_URL` é opcional e deve ser HTTPS para habilitar o botão de relatório.

### Importar o arquivo privado ou cadastrar o JSON

Foi preparado um arquivo `.env.vercel` privado, fora do repositório, contendo as três variáveis obrigatórias e os dois ajustes opcionais. Em **Settings → Environment Variables**, use a opção de importar `.env` e selecione **Production**. O arquivo não inclui `ML_*`, para preservar valores já cadastrados. Confira as cinco chaves e faça **Redeploy** da produção depois de salvar. Credenciais de produção não devem ser replicadas para previews; use outro projeto Firebase para testes.

No arquivo dotenv, o JSON ocupa uma única linha entre aspas simples. Se preferir cadastrar manualmente no painel, escolha a chave `FIREBASE_SERVICE_ACCOUNT_JSON` e cole como **valor** o conteúdo integral do arquivo JSON, começando com `{` e terminando com `}`: sem `FIREBASE_SERVICE_ACCOUNT_JSON=`, sem blocos de código e sem apenas o e-mail ou o `private_key`. Mantenha os campos originais e os `\n` da chave dentro do JSON. Marque a credencial como sensível. O arquivo JSON minificado separado também serve para essa cópia.

O servidor aceita JSON normal, JSON codificado como string e aspas simples externas; verifica projeto, e-mail opcional e chave RSA sem imprimir entradas ou erros internos do parser. O validador de publicação compartilha as mesmas regras.

O validador `npm run vercel:check` verifica as variáveis de produção sem imprimir valores. Execute-o em um ambiente que tenha recebido essas variáveis; uma configuração local com `localhost` e caminho de arquivo será rejeitada para publicação.

Para validar localmente o arquivo privado com Node.js 24, carregando somente suas variáveis:

```bash
node --env-file=/caminho/privado/.env.vercel --import tsx scripts/check-deployment.ts
```

O script não carrega `.env.local` automaticamente. Os testes fazem essa validação com configurações sintéticas; a revisão também validou o arquivo privado real e uma leitura autenticada do Firestore, sem alterar documentos.

### Diagnóstico da credencial

| Mensagem / situação                                 | Correção                                                                                                  |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| JSON ausente ou vazio neste deploy                  | Verificar valor, escopo **Production**, eventuais configurações específicas de branch e fazer Redeploy.   |
| Caminho local configurado                           | Remover a variável de caminho e usar o JSON completo; nenhum arquivo da máquina local é enviado à Vercel. |
| JSON inválido ou `type` incorreto                   | Copiar novamente a conta de serviço, sem prefixo de variável, e não usar `firebaseConfig`.                |
| Projeto ou e-mail divergente                        | Usar `project_id=datamat-ml`; corrigir o e-mail opcional ou removê-lo.                                    |
| `private_key` ausente, inválida ou truncada         | Copiar novamente o arquivo original completo, preservando as quebras de linha.                            |
| Ainda aparece o diagnóstico genérico antigo         | Conferir se o deploy ativo inclui o código revisado e fazer Redeploy depois de salvar variáveis.          |
| Credencial válida, mas acesso negado pelo Firestore | Conferir chave não revogada, conta ativa, banco `(default)`, API habilitada e permissões IAM da conta.    |

O código exige o contexto do portal ou proteção de acesso da hospedagem para restringir operadores quando colocado na internet. Não há login próprio nem validação de sessão do portal nesta versão; qualquer visitante com acesso à aplicação assume o responsável único. A proteção da hospedagem deve permitir a chamada de notificações do ML ao endpoint público correspondente, sem abrir as demais operações privadas.

## URLs para cadastrar na aplicação Mercado Livre

Para o endereço de produção atual:

- **URIs de redirect:** `https://datamat-ml.vercel.app/api/mercadolivre/callback`
- **URL de retornos de chamada de notificação:** `https://datamat-ml.vercel.app/api/mercadolivre/notifications`

Não cadastrar os placeholders literalmente. Não usar `localhost`, URL temporária de uma execução cloud ou domínio de preview que muda a cada commit. O redirect deve ser exatamente igual a `ML_REDIRECT_URI`. Cadastrar os tópicos suportados **items**, **orders_v2** e **questions** quando a aplicação oferecer essa escolha; habilitar as permissões de leitura necessárias e renovação de acesso conforme o portal ML.

Com as quatro variáveis ML configuradas, fazer Redeploy e usar **Configurações → Integrações → Conectar conta ML** em cada loja. Autorizar `juntos.com` na loja correspondente e depois `juntos.data`; o mesmo vendedor não pode ocupar duas lojas. O site não pede nem armazena a senha do Mercado Livre. Em seguida, sincronizar o catálogo e continuar os lotes de 20 até concluir a consulta.

As notificações são recebidas com resposta 202, validação de aplicação/recurso e deduplicação em caixa limitada. São sinais para consultar novamente os dados, não instruções para alterar preço ou estoque. Nesta etapa não há worker/cron que processe essa caixa automaticamente; a consulta é iniciada na interface.

## Verificações antes e depois

Antes: `npm run typecheck`, `npm test`, `npm run build` e `npm run test:e2e`. O emulador e Chromium são ferramentas de teste; não entram na aplicação publicada.

Depois: consultar `/api/workspace`, conferir ausência de erros da credencial, testar uma gravação própria a partir do domínio de produção e finalizar o OAuth pelo botão da loja. A integração real precisa validar os contratos/permissões da aplicação ML: as APIs/documentação oficiais retornaram 403 neste ambiente, e os testes de integração foram feitos com respostas simuladas controladas. O SDK oficial foi consultado para o fluxo OAuth.

O usuário já publicou em `https://datamat-ml.vercel.app`. Na revisão da configuração, `/api/workspace` inicialmente retornou 503 por credencial administrativa ausente ou inválida; na conferência final, respondeu **200**. O arquivo administrativo original também passou na validação e autorizou uma leitura real do Firestore. Sem acesso autenticado ao painel Vercel, os valores cadastrados e a ação que corrigiu o deploy não puderam ser inspecionados. Alterações futuras das variáveis exigem Redeploy no painel. Previews devem usar credenciais e projeto Firestore de teste separados.
