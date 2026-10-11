# Firebase no DATAMAT

Cloud Firestore, banco `(default)`, projeto `datamat-ml`. Firebase Admin acessa o banco no servidor Next.js. A configuração web pública foi registrada em `.env.example` e `.env.local`; ela não concede acesso administrativo. Firebase Authentication, Analytics e Storage não participam do fluxo atual.

## Credenciais

A conta configurada é `firebase-adminsdk-fbsvc@datamat-ml.iam.gserviceaccount.com`. Neste ambiente, `.env.local` aponta para o arquivo recebido, fora do repositório, com permissão `600`. A chave privada não foi adicionada ao código, aos scripts de instalação ou ao rascunho de configuração.

Na Vercel, configure `FIREBASE_SERVICE_ACCOUNT_JSON` com o JSON administrativo completo como segredo; caminhos da máquina local e ADC não são usados na hospedagem. Remova variáveis de caminhos locais e emulador do painel e faça Redeploy. Veja [configuração e diagnóstico da Vercel](vercel.md).

Fora da Vercel, configure uma alternativa:

- `FIREBASE_SERVICE_ACCOUNT_JSON`: JSON completo inserido como segredo no ambiente do processo pelo gerenciador da hospedagem.
- `FIREBASE_ADMIN_CREDENTIALS_PATH`: caminho absoluto de um arquivo de credencial montado de forma segura, fora do Git.
- Application Default Credentials: identidade de serviço gerenciada ou `GOOGLE_APPLICATION_CREDENTIALS` válido, quando as duas alternativas anteriores não forem usadas.

Mantenha `FIREBASE_PROJECT_ID=datamat-ml`. Credenciais JSON devem corresponder ao projeto e, quando `FIREBASE_SERVICE_ACCOUNT_EMAIL` for informado, ao e-mail esperado. O servidor valida a estrutura e a chave RSA, normaliza as quebras de linha e informa correções sem expor valores. A conta deve ter permissão no Firestore, por exemplo `roles/datastore.user`. Não use variáveis `NEXT_PUBLIC_*` para credenciais privadas.

## Inicialização

`npx tsx scripts/init-env.ts` preserva valores existentes e acrescenta configurações ausentes. `npm run db:migrate` carrega a configuração local e inicializa o banco idempotentemente. `_datamat_schema/001_initial` controla a operação. São criadas somente organização, lojas `juntos.com` e `juntos.data`, parâmetros pendentes, conexões ainda indisponíveis e reservas de identificações.

A aplicação abre sem login e usa um contexto de operador único definido no servidor (`APP_OPERATOR_NAME`), limitado à organização DATAMAT e suas lojas ativas. Não cria senhas, usuários ou sessões. Documentos antigos de usuários permanecem preservados para identificação de auditorias antigas; as APIs de login e gestão de usuários foram removidas. A identidade individual e as permissões do portal ainda precisam ser integradas.

O SDK usa gRPC. Esse transporte funcionou nesta máquina cloud com o proxy HTTPS disponível; o transporte REST do SDK falhou na conexão. Nenhuma verificação TLS foi desativada.

## Regras e índices

`firestore.rules` nega leitura/escrita diretamente por clientes. As regras publicadas no projeto foram consultadas e já possuem essa política. Firebase Admin usa IAM e ignora regras de cliente; o servidor valida loja, organização, papel e cada operação.

`firestore.indexes.json` prepara exclusões de índices para JSON extenso e hashes de senha. A configuração está versionada, mas não foi publicada nesta etapa. Consultas atuais usam índices de campos individuais. Para aplicar a configuração com Firebase CLI autorizado:

```bash
firebase deploy --only firestore:rules,firestore:indexes --project datamat-ml
```

## Testes e dados

`npm test` e `npm run test:e2e` iniciam um emulador oficial isolado na porta 9080 e o encerram ao terminar. O download fixa versão, tamanho e SHA-256. Requer Java 21+. Para reutilizar um emulador local, informe `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`; `npm run emulator:start` inicia essa instância separadamente.

Os testes removem credenciais administrativas do processo de teste e usam IDs aleatórios `demo-*`. O servidor rejeita emulador configurado com projeto real. Não existe limpeza automatizada do banco operacional. O SQLite anterior e seu schema foram preservados em `data/`; não havia usuários, anúncios, propostas, tarefas ou notas para importar. Ele deixou de ser usado.

Leitura autenticada, inicialização, segunda execução idempotente e consultas do servidor ao Firestore real foram confirmadas. Inserção, edição transacional, leitura e exclusão também foram verificadas em um documento temporário UUID de `_datamat_review_checks`, removido ao terminar. O banco tem as duas lojas e permanece sem contas ou anúncios de teste.

Para repetir somente essa verificação técnica contra o banco real:

```bash
npx tsx scripts/verify-firestore.ts --write
```

O comando recusa configuração de emulador e remove apenas o documento que ele próprio criou, inclusive em sua rotina de limpeza. Os fluxos de negócio completos continuam sendo testados no emulador, sem inserir cadastros demonstrativos no projeto real. Veja [a revisão funcional](review.md).

Na revisão das variáveis, o JSON privado preparado para importação na Vercel autorizou uma leitura real do Firestore, sem escrita. A publicação do usuário em `https://datamat-ml.vercel.app` inicialmente respondeu 503 por configuração administrativa e, na conferência final, `/api/workspace` respondeu **200**. O painel Vercel não está autenticado neste ambiente para alterar ou inspecionar os valores. Restauração em nova tarefa ainda não foi validada. Configure backups/PITR, retenção e monitoramento conforme a operação.
