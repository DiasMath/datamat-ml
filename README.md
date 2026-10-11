# datamat-ml

Aplicação de gestão de anúncios para **juntos.com** e **juntos.data**, com identidade DATAMAT. Next.js App Router, React, TypeScript, regras financeiras no servidor e persistência no Firebase Cloud Firestore.

**Sem login próprio:** a aplicação abre diretamente. Nesta etapa, as operações usam um responsável único configurado no servidor; a identidade individual virá do portal existente. As pendências estão no [roadmap](docs/roadmap.md).

## Executar

Requisitos: Node.js **24.x**, npm, banco Firestore `(default)` ativo no projeto `datamat-ml` e credencial administrativa autorizada. Java **21+** é necessário somente para os testes no emulador.

```bash
cd /workspace/datamat-ml
npm ci
npx tsx scripts/init-env.ts
# Configure a credencial segura antes de inicializar o banco.
npm run db:migrate
npm run dev
```

Abra a aplicação na porta 3000. Não há cadastro de administrador, senha, token inicial ou botão de sair. O endereço antigo `/login` redireciona para a página inicial. Configure `APP_OPERATOR_NAME` para identificar o responsável único no histórico. Esse nome não autentica pessoas; a integração com o portal ainda precisa fornecer identidade e permissões verificadas pelo servidor.

O script acrescenta configurações públicas ausentes e preserva os valores existentes de `.env.local`. A chave web do Firebase identifica o projeto; o acesso administrativo exige `FIREBASE_SERVICE_ACCOUNT_JSON` (segredo no ambiente) ou `FIREBASE_ADMIN_CREDENTIALS_PATH` (arquivo seguro fora do Git). Neste ambiente, o caminho aponta para o arquivo recebido. O e-mail da conta de serviço é validado contra a configuração. Alternativamente, copie `.env.example` e configure as variáveis manualmente.

**Dados:** documentos persistem no Cloud Firestore do projeto `datamat-ml`; recarregar a página ou acessar outra instância autorizada mantém os dados. A inicialização idempotente cria somente a organização, duas lojas, parâmetros pendentes e registros de configuração. Não cria contas, anúncios ou tarefas demonstrativas. O antigo arquivo SQLite foi preservado localmente e estava sem dados operacionais; ele não é mais utilizado. Testes usam projetos aleatórios `demo-*` no emulador, sem acessar o banco real.

A aplicação não cria usuários nem sessões locais. Firebase Authentication, Storage e Analytics não são utilizados nesta etapa. O navegador consulta a API Next.js; somente o servidor usa Firebase Admin. Veja [configuração Firebase](docs/firebase.md).

## Primeira rotina

1. Configurações → Lojas e parâmetros: conferir a base da comissão de gestão (inicia em 1%), impostos e margens. Valores desconhecidos permanecem pendentes.
2. Anúncios → Novo anúncio: selecionar loja, criar ou reutilizar um produto e informar a oferta. Produtos podem ter vários anúncios; o SKU não é uma chave única. Kits/variações exigem componentes de produtos já cadastrados.
3. Ficha → Custos e preço: registrar cada custo, usando `0` somente quando o custo realmente for zero. Substituições específicas preservam zero; parâmetros não substituídos são herdados da loja.
4. Precificação: preço, desconto e custos previstos recalculam ao digitar, sem Enter ou gravação. Os custos digitados podem entrar na proposta; Salvar para revisão faz o servidor recalcular, conferir versões e registrar o cenário sem alterar a condição atual.
5. Visão geral → Revisar / avançar etapa: aprovação → solicitação → execução no ML/Bling → confirmação manual com evidência. Para anúncio individual elegível, Aplicar preço no ML confere a tarifa, envia após confirmação e consulta o resultado. Outras mudanças seguem confirmação manual; dados ou parâmetros alterados exigem revisão.
6. Histórico: consultar valores anteriores, novos valores, origem, responsável e retratos financeiros preservados. Atualizar custos não recalcula decisões passadas.

Cadastros de tarefas e notas podem ser editados ou excluídos com confirmação e histórico preservado. Rascunhos sem vínculos também podem ser excluídos; anúncios em operação ou com propostas devem ser encerrados. A ficha permite corrigir nome, modelo, marca e categoria do produto compartilhado. Propostas que deixaram de fazer sentido podem ser canceladas com justificativa.

As tabelas têm ordenação por cabeçalho, largura ajustável/restaurável e preferências de largura por navegador. Em Anúncios, Ações em lote permite editar até 100 cadastros, excluir até 40 rascunhos/referências sem vínculos e ativar/pausar anúncios próprios no ML, com confirmação e resultado individual. Inserção e atualização em massa continuam pela planilha. Ver [tabelas e operações em lote](docs/tables-and-bulk.md).

O contexto atual tem acesso às lojas ativas da organização DATAMAT e pode cadastrar, aprovar e confirmar operações. O motor mantém verificações de papel e loja para a futura integração com o portal, mas ainda não identifica operadores individuais. Organização, papel e responsável enviados pelo navegador não são aceitos como identidade.

## Listas, importação e exportação

Anúncios, ações, notas, histórico, registros de integração e prévia de importação usam áreas de rolagem limitadas. As listas maiores mostram paginação de 20, 50 ou 100 registros, com página e filtros na URL. Tabelas conservam o cabeçalho durante a rolagem. Paginar, ordenar ou alternar abas não recarrega o catálogo; mutações e o botão Atualizar renovam os dados. A consulta inicial ainda carrega os registros das lojas selecionadas; paginação por cursor no Firestore permanece necessária para grandes volumes.

Anúncios → Importar aceita **Excel .xlsx** e CSV UTF-8, delimitado por vírgula ou ponto e vírgula: até **2 MB e 1.000 linhas por arquivo**. Arquivos antigos `.xls` precisam ser salvos como `.xlsx`. Em planilhas com várias abas, selecione a aba desejada. O sistema sugere o mapeamento das colunas; confira a loja e a prévia completa antes de confirmar. O modelo Excel contém apenas o cabeçalho, sem registros fictícios.

- **Cadastrar novos anúncios:** impede duplicidades no arquivo e na loja. Valores canônicos: tipo `unit`; situação `draft`, `active`, `paused`, `closed`; origem `import` ou `reference`. Referências exigem `referenceAccount`. Kits/variações são cadastrados pela ficha com composição.
- **Atualizar anúncios exportados:** exige `id` e `version` atuais, na mesma loja. Permite título, descrição, SKU, código ML e situação; mantém produto, custos, origem e histórico. Planilhas antigas são bloqueadas. Preços exigem o fluxo de propostas; dados do produto compartilhado e composição são corrigidos pela ficha.
- **Gravação em lotes:** a prévia verifica o arquivo inteiro antes da primeira gravação. Cada lote de até 40 registros é atômico. Se um lote posterior falhar, os anteriores permanecem e o diálogo permite retomar com as mesmas chaves, sem duplicar gravações. Mantenha o diálogo aberto para essa retomada; não há atomicidade global de um arquivo com vários lotes.

Preços aceitam `100.50` ou `100,50`; vazio continua pendente. SKUs textuais preservam zeros iniciais. O leitor não executa fórmulas/macros; exportações tratam textos como texto e CSV neutraliza fórmulas.

**Exportar Excel** baixa todos os anúncios da consulta filtrada, incluindo páginas não exibidas. O arquivo contém identificadores e versões para atualização posterior, preço numérico e contribuição quando calculável. Configurações → Sincronização e dados também oferece CSV e JSON. JSON para BI inclui ofertas, tarefas, notas, propostas e histórico das lojas disponíveis, com retratos financeiros; não inclui usuários, sessões ou credenciais.

## Análises e tela ao vivo

O menu **Análises** inclui visão geral, vendas, produtos, tráfego, financeiro, operação e publicidade. Consulte hoje, ontem, 7/30/90 dias ou um período personalizado; compare lojas e o intervalo anterior. Rankings têm busca, paginação e rolagem, os gráficos têm tabela alternativa e os dados diários podem ser exportados para Excel em CSV.

**Análise ao vivo** acompanha o dia por hora, últimos pedidos e prioridades, com consulta a cada 60 segundos, pausa e tela cheia. As telas mostram a hora da consulta, cobertura e falhas. A contribuição é estimada com custos atuais, publicidade é conferida manualmente e recursos sem resposta do ML ficam indisponíveis. [Indicadores, origens e limites](docs/analytics.md).

## Rotina integrada

Hoje inclui vendas, contribuição prevista/ajustada com tarifa observada, tarefas operacionais e cobertura de estoque. Concorrência guarda referências, histórico observado, alertas e exportação. Webhooks acionam consultas verificadas em segundo plano; o cron diário exige uma única CRON_SECRET da infraestrutura. Fontes, limites e aplicação de preços: [docs/daily-operation.md](docs/daily-operation.md).

## Validar

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Os comandos de teste iniciam e encerram o emulador na porta 9080 e verificam SHA-256 do artefato oficial. Um emulador existente pode ser informado por `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`. O teste de navegador inicia a build de produção na porta 3100 com projeto isolado no emulador. Usa Chromium em `/usr/bin/chromium`; em outra máquina, configure `PLAYWRIGHT_CHROMIUM_PATH` para seu executável. O teste real da extensão usa Chrome for Testing, instalado automaticamente pelo runner quando ausente; PLAYWRIGHT_BROWSERS_PATH permite reutilizar o cache. O teste cobre cadastro, filtros/retorno, custos, simulação, aprovação, confirmação, histórico, recarga, segunda sessão, skeletons, toasts, rotina e extensão. Capturas e traces ficam em `test-results/`, ignorado pelo Git.

Os testes de domínio/serviço cobrem precisão decimal, campos vazios versus zero, bases de cálculo, limites inviáveis, isolamento de lojas, validação, produtos com vários anúncios, composição, idempotência, importação atômica, histórico imutável, CRUD e falhas externas. A revisão de layout percorre telas e abas em seis larguras, de 320 a 1440 pixels, incluindo formulários, navegação e filtros. Veja [validação](docs/validation.md) e [revisão funcional](docs/review.md) para os resultados e limites da implementação.

## Disponibilizar para outros dispositivos

```bash
npm run build
npm run start
```

Disponibilize a porta 3000 por um proxy reverso **HTTPS** e configure `APP_URL` com a origem pública exata, por exemplo `https://gestao.seudominio.com.br`. Essa origem valida mutações contra CSRF. Antes de disponibilizar fora do ambiente atual, conecte o controle de acesso do portal: a aplicação não tem autenticação própria. A aplicação escuta em `0.0.0.0`; não exponha HTTP diretamente na Internet. Next.js e os scripts CLI carregam `.env.local`, respeitando variáveis fornecidas pelo processo.

Em cada servidor, forneça uma credencial segura da conta autorizada e o mesmo `FIREBASE_PROJECT_ID`. Prefira identidade de serviço gerenciada no Google Cloud ou JSON mantido no gerenciador de segredos da hospedagem. Configure backup/PITR e retenção no Firestore conforme a operação; valide uma restauração. Não inclua a chave privada no bundle, no Git ou em variáveis `NEXT_PUBLIC_*`.

O usuário publicou em `https://datamat-ml.vercel.app`. A configuração segura das variáveis da hospedagem é descrita em [Vercel](docs/vercel.md); os arquivos privados do ambiente cloud não são enviados ao GitHub.

## Integrações e limites desta versão

- **Mercado Livre:** OAuth por loja, renovação e proteção dos tokens, importação em lotes, tarifas por cenário, métricas por período, checklist e recebimento de notificações implementados. Testes com respostas controladas; ativação real depende da publicação HTTPS, credenciais e autorização das contas. Frete/promoções e escrita externa ainda dependem de integração específica. Ver [integrações](docs/integrations.md).
- **Bling:** contrato preparado. Faltam `BLING_CLIENT_ID`, `BLING_CLIENT_SECRET`, `BLING_REDIRECT_URI`, autorização por conta e adapter. Não há sincronização concorrente de preços/estoque.
- **IA:** indisponível. Faltam provedor, adapter e `AI_API_KEY`. Verificações internas são regras determinísticas e informam dados usados, data e limitações. Cálculos financeiros não são delegados à IA.
- **Power BI:** exportação CSV/JSON funciona; o botão do relatório depende de `POWER_BI_REPORT_URL` HTTPS. Não há push automático para o Power BI.

Credenciais ML são cadastradas por loja em **Configurações → Integrações**, cifradas no Firestore e nunca devolvidas à interface ou exportações. Adicionar lojas/aplicações não exige código nem novas variáveis na Vercel. Sua presença não significa autorização de uma conta: depois de salvar, use **Conectar conta ML**. Consulte [integrações](docs/integrations.md).

Avisos temporários aparecem em toasts sobrepostos com uma barra superior de tempo restante, fechamento manual e pausa ao passar o mouse, focar pelo teclado ou sair da aba. Eles não deslocam o conteúdo nem tomam o foco. Ao salvar, a página permanece visível durante a atualização; erros dentro de modais usam a mesma experiência.

Fora do escopo concluído: validação operacional com contas reais, escrita de conteúdo/estoque e variações individuais, gestão de outras organizações pela interface, identidade/permissões do portal e consultas de grandes volumes com paginação Firestore. A separação por organização existe no banco e nas validações; novas lojas podem ser adicionadas na organização atual.

## Organização do código

- `src/app`: rotas, layout e estilos.
- `src/components`: navegação/telas, formulários, precificação, importação e componentes comuns.
- `src/domain`: cálculos decimais e CSV, sem acesso à rede/banco.
- `src/server`: banco/migrações, contexto de acesso, validações, serviços transacionais e contratos externos.
- `firestore.rules`, `firestore.indexes.json`: política para clientes e índices versionados.
- `scripts`: inicialização idempotente e testes com emulador verificado.
- `tests`: testes isolados de domínio, serviços e navegador.

Veja [arquitetura e modelo](docs/architecture.md). A logo oficial foi obtida de `https://www.datamat.com.br/assets/datamat-horizontal-Cnr-y6m5.svg`; a geometria foi preservada. A aplicação operacional é independente do site institucional.

Referências funcionais do Avantpro e plano da futura extensão: [docs/avantpro.md](docs/avantpro.md). Primeira extensão implementada: download em Configurações → Extensão, pareamento por loja, precificação ao digitar e captura assistida de referências. Instalação em [extension/README.md](extension/README.md).

Precificação ao digitar, fórmulas auditadas e limites: [docs/pricing.md](docs/pricing.md). Pesquisa de ferramentas e prioridades por módulo: [docs/research-mercado-livre.md](docs/research-mercado-livre.md).

## Publicar na Vercel

Configuração pronta em `vercel.json`, com Node.js 24, build Next.js e Firestore no servidor. Variáveis obrigatórias/opcionais, importação privada, diagnóstico e URLs OAuth/notificações estão em [docs/vercel.md](docs/vercel.md). No endereço atual `https://datamat-ml.vercel.app`, use `APP_URL` com essa origem e `FIREBASE_SERVICE_ACCOUNT_JSON` como segredo completo; o caminho da credencial deste ambiente não existe na hospedagem. Salvar variáveis exige Redeploy para atualizar a aplicação publicada.

Melhorias adicionais: prioridades explicáveis para margem negativa/estoque/custos, checklist que cria tarefas sem duplicação, métricas com origem e intervalo, ROAS/ACOS/TACOS manuais ao digitar e saúde das conexões por loja.

## Campanhas e diagnóstico dos anúncios

Análises → Publicidade salva/importa relatórios reais por campanha/período com ROAS, ACOS, CTR, CPC, CPO e contribuição estimada. Análises → Diagnóstico compara vendas, margem e ajustes, sem inferir vitória de catálogo. A ficha consulta competição opcional, exibe mídia/ficha técnica observadas e analisa termos das referências vinculadas. Atualização ML em lotes de 60 segundos enquanto visível e sem edição, com datas, conflitos e preservação de rascunhos. Product Ads automático e Clips completos continuam pendentes. Ver [uso e limites](docs/intelligence.md).
