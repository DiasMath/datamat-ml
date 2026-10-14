# Validação da versão atual

Ambiente cloud: Node.js 24, Next.js 16.4, React 19.3, Java 21 e Chromium. A revisão atual compacta Hoje para anúncios, preços e desempenho, com prioridades verificáveis e resposta inicial menor. As revisões anteriores de cabeçalhos, operações em lote, precificação, integração ML, extensão, mídia/Drive e diálogos permanecem cobertas pelos testes. Testes de negócio usam projetos aleatórios `demo-*` no emulador Firestore e não escrevem cadastros na base operacional `datamat-ml`.

| Verificação              | Resultado                                                                                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript               | `npm run typecheck`: passou                                                                                                                                |
| Domínio e serviços       | `npm test`: **180 passaram**, nenhuma falha ou teste ignorado                                                                                              |
| Build de produção        | `npm run build`: passou                                                                                                                                    |
| Navegador Chromium       | `npm run test:e2e`: **66 passaram** na suíte completa; **12 passaram** na conferência final, incluindo um novo cenário                                     |
| Formatação               | Prettier em código, scripts, testes e documentação: passou                                                                                                 |
| Dependências de produção | `npm audit --omit=dev`: **0 vulnerabilidades reportadas**                                                                                                  |
| Responsividade           | 17 telas/abas × 6 larguras: **102 combinações**, sem transbordamento horizontal do documento                                                               |
| Firestore real           | CRUD técnico isolado confirmado na revisão anterior; JSON privado preparado para Vercel validado com leitura autenticada, sem alterar documentos           |
| Publicação do usuário    | `https://datamat-ml.vercel.app/api/workspace`: inicialmente 503; conferência final **200**, sem acesso autenticado ao painel para conferir/alterar valores |

## Comportamentos exercitados

- Entrada direta e redirecionamento de `/login`, sem senha, usuário local ou sessão. APIs antigas de login/usuários indisponíveis; identidade falsa em headers/cookies não altera a organização ou lojas do contexto do servidor. Papéis e isolamento continuam exercitados diretamente nos serviços para a futura integração do portal.
- CRUD de ofertas, produto compartilhado, tarefas e notas; exclusões permitidas deixam auditoria e limpam dependências. Verificações pelo SDK confirmam o documento persistido após ações e recarga, independentemente da interface.
- Custos separados, zero versus desconhecido, precisão decimal, simulação e proposta. Salvar/aprovar não altera o preço. Aprovação → solicitação → confirmação manual com evidência persiste o preço, em recarga e outro contexto de navegador.
- Edições concorrentes, propostas desatualizadas, parâmetros revisados, reenvios concorrentes e unicidade de código ML; sem sobrescrita silenciosa ou decisões duplicadas.
- Kits/variações, composição e mudança para unidade; produto com múltiplos anúncios e SKU repetido permitido. Alterações em lote afetam somente os anúncios selecionados.
- Lojas e parâmetros financeiros; integração indisponível gera erro verdadeiro e registro, sem alteração externa simulada.
- CSV com mapeamento e confirmação; Excel com múltiplas abas, SKU com zero inicial, preço numérico, modelo só com cabeçalho e exportação de todas as páginas da consulta filtrada.
- Exportar, editar e reimportar um anúncio mantém ID/produto/custos/origem/histórico; versões antigas, loja divergente, composição e mudança de preço fora do fluxo são bloqueadas.
- Prévia de até 1.000 linhas detecta duplicidades entre lotes antes de gravar. Limite atômico de 40 linhas por confirmação. Arquivo de 45 registros com resposta perdida após commit do segundo lote retoma com a mesma chave: **45 ofertas e 45 cadastros auditados, sem duplicação**.
- Tabela de 61 anúncios: cabeçalho fixo, rolagem interna, 20/50 registros exibidos, navegação sem nova consulta do workspace e exportação completa. Ações/notas/histórico com 65 registros cada têm rolagem limitada e paginação independente.
- Textos com aparência de fórmula exportados como texto; arquivo inválido, criptografado ou com expansão excessiva é rejeitado. O leitor não executa macros ou fórmulas.
- Layout em 320, 360, 390, 768, 1024 e 1440 pixels, com conteúdo longo. Cinco outros tipos de diálogo e entrada direta em quatro larguras; filtros e formulário de oferta também exercitados. Menu móvel fecha por Escape e retira o fundo do foco. Erros de carregamento limpam dados antigos e permitem nova tentativa.

Capturas em `test-results/review/`, traces de falhas e relatórios são locais e ignorados pelo Git. Foram inspecionadas visualmente as capturas da lista de anúncios em desktop e celular. Os registros maiores criados pelos testes permanecem somente no emulador isolado.

## Limites da validação

O emulador verifica persistência e regras de negócio, sem garantir que todos os fluxos comerciais foram usados em uma conta real. O CRUD técnico anterior no Firebase real usou um único documento UUID em `_datamat_review_checks`, removido depois. A verificação atual não introduz anúncios/tarefas de teste no projeto real.

OAuth/catálogo/tarifas/métricas e alterações ML foram implementados e testados com respostas controladas. Não foram autorizadas contas reais nem validados contratos/permissões na aplicação ML do usuário: API/documentação retornaram HTTP 403 neste ambiente. Bling, IA, inspeção autenticada das variáveis da publicação, portal, backup/restauração e pipeline Power BI permanecem pendentes. A primeira extensão está implementada e testada no Chrome; captura em páginas reais ainda precisa de conferência. Regras publicadas do projeto real já negam acesso direto de clientes; índices versionados não foram publicados. Paginação é visual: a consulta inicial ainda carrega os registros das lojas selecionadas. Importação com vários lotes preserva os lotes concluídos, sem atomicidade do arquivo inteiro.

As fontes públicas do Avantpro foram pesquisadas, mas a experiência Free/Pro e a extensão paga não foram testadas. Veja [avantpro.md](avantpro.md), [roadmap.md](roadmap.md) e [README](../README.md).

## Revisão adicional da precificação

- Preço digitado `1` → `15` e custo `1` → `15`: contribuição atualizada a cada tecla, foco mantido, sem Enter/blur/salvar e sem request de mutação. O SDK confirmou preço e custos atuais intactos.
- Preço vazio/subcentavo, desconto `100%`, custos inválidos e campos desconhecidos não mantêm uma contribuição antiga como se ainda fosse válida.
- Quatro combinações de bases para impostos/gestão, contribuição ML, custos previstos completos e limites seguros de desconto em tickets grandes foram conferidos por exemplos independentes.
- Alterar taxas/frete com preço inalterado exige revalidação; voltar de alíquota específica zero à herança da loja funciona no cálculo, proposta e aplicação.
- Proposta global com custos não salvos tem snapshot recalculado no servidor e não modifica custo/preço atuais; aplicação aprovada persiste os custos propostos.
- Autocomplete reutiliza marca, modelo, categoria, produto/SKU, busca, tarefas/responsáveis e títulos de notas; aceita texto novo e preserva zeros em SKUs. Motor de sugestões verifica acentos, caixa, deduplicação e limite de opções.
- Precificação global verificada em 320/390/768/1440 pixels, além da revisão das 17 telas/abas em seis larguras. Capturas em `test-results/pricing-live-desktop.png` e `test-results/pricing-live-mobile.png`. No desktop, a contribuição permanece no viewport ao editar custos; no celular, o resumo acompanha a digitação.

Fórmulas e limites comerciais: [pricing.md](pricing.md). Pesquisa e fontes: [research-mercado-livre.md](research-mercado-livre.md).

## Mercado Livre e Vercel

- Tokens protegidos com AES-256-GCM, falha de integridade, URLs de retorno inválidas, state/cookie/PKCE, expiração/negação/reuso e isolamento de vendedores/lojas. Nenhum token aparece na projeção pública.
- Importação idempotente preserva custos/tarefas, registra mudanças reais e retoma a página interrompida sem repetir scan ou duplicar o anúncio. Condições comerciais invalidam propostas antigas mesmo se o preço não mudar. Variações com preços diferentes bloqueiam proposta agregada.
- Tarifa vinculada a preço/versão/vendedor, decomposição reconciliada, expiração, adulteração ignorada pelo servidor, alterações externas e renovação concorrente de token. Desconectar invalida consultas em andamento.
- Visitas e pedidos pagos do mesmo intervalo, pedidos duplicados/cancelados, receita bruta separada de recebimento, dados de compradores não persistidos e volumes incompletos não gravados como completos.
- Notificações deduplicadas em caixa limitada, rejeição de outra aplicação, recursos arbitrários descartados e nenhum preço alterado por payload.
- `vercel.json` sem erros de configuração segundo o schema oficial. Node.js 24.x fixado. Validador passou com o JSON administrativo e rejeitou origem localhost e falta do JSON para a hospedagem. Segredos não foram exibidos nem adicionados ao repositório.

Os testes Chromium da integração usam contratos controlados: consulta após pausa, respostas obsoletas descartadas, snapshot oficial preservado, modo manual explícito em falha, checklist/tarefa, publicidade ao digitar e responsividade em 320/390 pixels. Esse conjunto complementa a revisão de 102 combinações das telas.

## Análises e favicon

- Favicon SVG com o logotipo enviado, servido por `/icon.svg` e declarado automaticamente pelo Next.js.
- Data/hora de Brasília, limites de datas, comparação com o mesmo tempo transcorrido, pedidos pagos/cancelados, deduplicação entre pedidos e isolamento entre lojas.
- Precisão decimal da receita/tarifas, preço efetivamente vendido na contribuição, custos ausentes/desatualizados e cobertura da parcela estimada.
- Cache e reserva de consulta por vendedor, troca de autorização ocultando o retrato antigo, identidade de outros vendedores rejeitada e dados pessoais de compradores/tokens fora dos retratos.
- Falhas opcionais não impedem vendas; páginas incompletas geram erro, mais de 1.000 pedidos gera relatório parcial e atualização com falha preserva o retrato sem comparação enganosa.
- Navegação nas sete áreas, troca do indicador do gráfico, ranking de 25 produtos paginado, exportação CSV e publicidade recalculada ao digitar.
- Tela ao vivo consulta automaticamente, pausa/retoma, atualiza após 60 segundos e entra em tela cheia.
- Responsividade adicional em 320/390/768/1024/1440 pixels; capturas desktop/celular inspecionadas visualmente. O gráfico não preenche horários futuros com zero, e a última consulta informa segundos.
- A rota de análise valida loja, período e origem das mutações. Testes API usam emulador isolado; os dados dos gráficos dos testes são respostas controladas.

Permissões e contratos do ML real ainda precisam ser conferidos com a conta autorizada. Publicidade automática, conciliação e reclamações/devoluções permanecem pendentes. Concorrência assistida está implementada; coleta recorrente continua pendente. Veja [analytics.md](analytics.md).

## Revisão das variáveis de ambiente

- Nove testes adicionais cobrem JSON normal/codificado como string, aspas externas, BOM, espaços e quebras de linha da chave; campos ausentes, projeto/e-mail divergentes e chave inválida recebem mensagens específicas sem expor entradas.
- A Vercel exige o JSON completo e rejeita emulador; caminhos locais nunca são lidos na hospedagem. Fora dela, arquivo local e ADC continuam disponíveis. Um JSON inválido não é ignorado em favor de outra credencial.
- Validador de deploy e servidor compartilham as mesmas regras. Aplicação ML exige ID numérico, segredo e callback da mesma origem. A proteção usa a chave canônica base64 de 32 bytes já existente ou, nas instalações com conta administrativa Firebase, uma chave derivada dessa identidade; valores existentes não são substituídos.
- O arquivo privado com cinco variáveis foi carregado pelo parser dotenv do Next.js e passou no validador com valores reais. O Firebase Admin realizou uma leitura autenticada usando exatamente esse JSON, sem escrita e sem imprimir segredos.
- Os 110 testes, o build, a verificação TypeScript e os 37 testes Chromium passaram depois das alterações. Testes de tela cobrem CRUD, persistência, Excel, cálculos ao digitar, análises e responsividade.
- A publicação inicialmente respondeu 503 e passou a responder **200** em `/api/workspace` na conferência final. O painel Vercel não está autenticado neste ambiente para inspecionar os valores ou identificar a ação que corrigiu o deploy. Importação em **Production**, remoção de variáveis locais e **Redeploy**, quando necessários, devem ser feitos no painel; salvar variáveis não atualiza uma publicação existente. Veja [passo a passo](vercel.md).

## Toasts e aplicações configuradas pelo site

- Nove testes de serviço adicionais: aplicativos distintos por loja sem variáveis individuais, segredo cifrado e ausente das projeções, OAuth/refresh com a aplicação correta, edição sem mudança preservando tokens, rotação invalidando state e token somente da loja, edição concorrente, notificações por aplicativo/vendedor, permissões/isolamento/AAD e derivação de chave a partir da identidade Firebase.
- Cinco novos testes Chromium: posição da página antes/depois dos avisos, barra de tempo restante, pausa por mouse/teclado, desaparecimento automático, erro no modal sem deslocar campos ou tirar foco, alvos de toque e largura móvel, recarga sem substituir a página, nova loja e credenciais cadastradas/editadas pela interface, segredo omitido após recarga e rejeição de outra origem.
- A revisão corrigiu uma corrida entre digitação e recarga após salvar: o conteúdo permanece visível, com controles temporariamente desabilitados até receber a versão atualizada. O fluxo completo de preço/custos/proposta/aprovação/aplicação passou novamente. Condições e limites da precificação ficam em uma seção recolhida, sem expansão automática causada por avisos.
- A captura móvel de toast dentro do modal foi inspecionada visualmente. As telas existentes também foram revisadas em seis larguras, sem transbordamento horizontal.
- A integração real ainda depende da autorização do vendedor pelo botão Conectar conta ML. Cadastrar uma aplicação não consulta anúncios privados nem aplica preços no Mercado Livre.

## Rotina diária, carregamento e primeira extensão

- Dezesseis novos testes de negócio: contribuição prevista/ajustada, ausência de custos e cobertura, demanda de sete dias/estoque atual, dados parciais/antigos/conta divergente, CRUD/histórico/alertas de concorrentes, permissões/URL/versão/tarefa idempotente, token de extensão com hash/escopo/origem/revogação, recaptura preservando limiar, processamento oficial de sinais/leases/cache/backoff, descarte de outro vendedor e autenticação do cron.
- Aplicação de preço aprovado: um único PUT seguido de leitura, proposta/loja/permissão/tarifa conferidas e auditoria idempotente. Resposta incerta não causa novo envio; teste inclui notificação observando o novo preço antes da conferência. Custos modificados depois não são substituídos pela proposta antiga.
- Seis novos testes de navegador: barra de toast em movimento reduzido, pausa simultânea de relógio e largura, skeletons nas consultas iniciais em 320 px, CRUD/histórico/tarefa de concorrência, Hoje com skeleton até receber vendas, preservando dados/paginação/pausa e captura assistida de DOM suportado.
- Chrome for Testing carrega a extensão Manifest V3 real, pareia com o servidor/emulador isolado, consulta custos, simula preço ao digitar, grava a referência pela API e desconecta. A leitura de páginas do ML usa HTML de teste; o retorno de captura no teste do painel é controlado. Captura em conta/página real ainda precisa de conferência, sem alegação de paridade completa com Avantpro.
- `public/datamat-extension.zip` contém somente cinco arquivos públicos; integridade CRC verificada. É gerado no build, sem credenciais. Pacote ainda não publicado na Chrome Web Store.
- Depois da suíte completa de 43 testes, 15 cenários de operações/revisão passaram novamente com os ajustes móveis e 102 combinações de telas/larguras; os quatro cenários de operações passaram uma última vez após o ajuste de skeleton da primeira consulta. Build e TypeScript também passaram novamente.
- Código e arquivos versionáveis verificados contra segredos locais; dependências de produção sem vulnerabilidades reportadas nesta revisão.
- Conta juntos.data foi consultada em produção e ainda aparece **unauthorized**; juntos.com, **unconfigured**. Uso de dados reais exige Conectar conta ML. Nenhum preço real foi enviado durante os testes. Cron diário exige configurar CRON_SECRET uma vez na infraestrutura e republicar; credenciais de novas lojas continuam pelo site.

Fontes, limites financeiros e operação: [daily-operation.md](daily-operation.md).

## Cabeçalhos e operações em lote

- Nove novos testes de negócio cobrem edição atômica com versões, reenvio idempotente, preservação de preços/custos, conflitos, isolamento, exclusão com dependências e histórico de referências, ativação/pausa confirmada, estoque zero, vendedor divergente, resultado parcial, leases concorrentes e recuperação de resposta incerta após recarga/notificação. PUT incerto nunca é reenviado automaticamente.
- Três novos testes Chromium exercitam ordenação numérica do conjunto completo antes da paginação, dados desconhecidos no final, seleção entre páginas, largura arrastada/persistida/restaurada, teclado e ausência de novas consultas ao ordenar; edição/exclusão persistidas pelo SDK após recarga; resultados parciais e retomada de ações ML com a mesma operação e versões atualizadas para uma nova ação.
- A revisão corrigiu o scroll das listas ao trocar de página: a posição é restaurada já no acionamento do controle. O teste também aguarda a navegação e a nova página antes de conferir o resultado.
- A suíte completa de 46 cenários inclui a revisão de 102 combinações de telas/larguras. TypeScript, build de produção e 135 testes de negócio passaram. O diálogo em lote foi conferido em 320 px.
- O fluxo de navegador de ativação/pausa usa respostas controladas e os testes de serviço simulam a API oficial. Nenhum anúncio real foi ativado, pausado ou teve preço alterado. Na última leitura de produção, juntos.data permanece `unauthorized` e juntos.com `unconfigured`; é necessário autorizar o vendedor pelo site.

Uso, limites e diferenças entre cadastro local e marketplace: [tables-and-bulk.md](tables-and-bulk.md).

## Campanhas, interface compacta e inteligência dos anúncios

- Quinze novos testes de domínio/serviço: precisão decimal dos indicadores e contribuição antes/depois de Ads, desconhecido versus zero, planilha/aliases, lote atômico/idempotência/versões, sobreposição e filtros sem rateio, permissão e loja, tarefa deduplicada/exclusão auditada, termos normalizados por título distinto, comparação com amostra/base/autorização, URLs de mídia seguras, mudanças de fotos/vídeo/estoque sem alterar custos, competição somente por leitura e rejeição de contexto divergente.
- Cinco novos cenários Chromium: topo 48 px no desktop/52 px no celular, picker estilizado com clique/teclado/escape e alvo de toque; campanha ao digitar, persistência/recarga/edição/tarefa/exclusão; Excel com prévia e CSV exportado atualizando o mesmo registro; diagnóstico de queda e margem negativa, fotos/ficha e competição abaixo do piso; polling refletindo alteração externa sem sobrescrever rascunhos, interrompido durante diálogo e aba oculta.
- Suíte completa: 150 testes de negócio e 51 cenários de navegador, sem falhas/ignorados. TypeScript e build de produção passaram. Mantidas as 102 combinações anteriores e acrescentadas quatro larguras para campanhas, diagnóstico e competição, além do diálogo e dropdown em 320 px.
- A revisão corrigiu o vínculo de autorização na projeção pública: a versão numérica passou a ser retornada, sem tokens, para os controles de métricas/competição/lotes. Dados de outra autorização não aparecem como atuais. Mídia/atributos detalhados são carregados na ficha e omitidos da lista recorrente.
- Capturas novas: `test-results/dropdown-options-mobile.png`, `campaign-report-mobile.png`, `campaigns-mobile.png` e `listing-competition-mobile.png`. A inspeção levou à remoção de cartões vazios, métricas compactas e campos adicionais recolhidos. Depois desse ajuste, os nove cenários de inteligência/marketplace, TypeScript e build foram conferidos novamente.
- Os relatórios locais de campanhas usam Firestore real no emulador. Consulta de competição, mudança oficial de mídia e polling usam respostas controladas; nenhuma campanha, preço ou anúncio real foi alterado. Product Ads automático e Clips completos continuam pendentes; recursos públicos do Avantpro foram pesquisados, sem instalação/inspeção da versão paga ou alegação de paridade completa.

Operação e limites: [intelligence.md](intelligence.md). Pesquisa: [avantpro.md](avantpro.md) e [research-mercado-livre.md](research-mercado-livre.md).

## Correção da autorização ML e preservação dos filtros

- A mensagem anterior dizia “renovar” também na conexão inicial. A validação agora distingue as duas operações, aceita inteiros seguros em texto e `Bearer` com diferenças de caixa/espaços, ignora metadados não utilizados e indica somente nomes dos campos inválidos. `refresh_token` continua obrigatório; sua ausência orienta conferir `offline_access`, sem inventar credenciais.
- Quatro novos testes de serviço cobrem resposta válida alternativa, nove entradas inválidas, identidade divergente, proteção dos tokens anteriores, contexto preservado no sucesso/negação/expiração, destinos externos recusados e renovação interrompida após resposta inutilizável. Nova autorização restaura a conexão nos contratos controlados.
- Dois cenários novos Chromium percorrem o retorno real da rota OAuth após negação e uma consulta com HTTP 502. Loja, busca, filtros repetidos, paginação e posição do conteúdo são preservados; recarregar mantém a seleção e a mensagem aparece em toast.
- `npm test`: **163 passaram**; `npm run test:e2e`: **57 passaram**; TypeScript e build de produção passaram, sem falhas ou testes ignorados. Todas as gravações desses testes ocorreram no emulador isolado; respostas do ML foram controladas.
- Leitura de produção antes da correção: `/api/workspace` HTTP 200; aplicações das duas lojas configuradas, vendedores ainda `unauthorized`, sem sincronização anterior. O payload real que causou a falha não está disponível; não foi realizada autorização em nome do usuário. É necessário iniciar uma nova conexão pelo site para conferir a conta real. Se persistir uma resposta inválida, a nova mensagem identifica os campos sem expor seus valores.

## Integração sem recarga, tabela operacional e mídia

- Permissões read/write/offline_access explicadas na integração e no formulário. Autorização em janela separada com loading, callback limitado por CSP, mensagens de mesma origem/canal por tentativa, falha e sucesso mantendo o documento original e todos os filtros. Badge conectado e indicador do menu verdes.
- Atividade de requisições centralizada com barra indeterminada e spinner sem deslocar conteúdo. Fluxos de consulta, gravação, precificação, análises, rotina, polling e exportação usam o indicador; fotos têm skeleton próprio e vídeos indicam buffering. Planilhas mostram loading durante leitura e envio. Indicadores ML mostram o lote em consulta.
- Tabela com foto, estoque, modalidade/frete, estimativa de recebimento somente com tarifa válida e frete conhecido, visitas/pedidos de sete dias e qualidade oficial versus checklist próprio. Preset de cadastro, filtros de catálogo/tradicional e contagens por ID/título mantêm registros separados.
- Leitura real: juntos.data conectado, 56 IDs únicos, 44 títulos distintos, 50 catálogo e seis tradicionais. As fotografias já estavam no Firestore; a projeção foi corrigida para disponibilizar uma miniatura sem carregar todo o conjunto de mídia. Não foram apagados cadastros ou combinados produtos por título.
- Rascunhos de fotos/vídeos: MIME/assinatura, tamanho, papéis/loja/organização, versão, upload idempotente, concorrência, leitura parcial/Range, exclusão auditada, rejeição durante envio e limpeza de tentativa cujo anúncio mudou. Testes usam emulador e armazenamento em memória; UI usa respostas controladas e persistência verificada pelo SDK.
- Os testes identificaram e a revisão corrigiu comparação textual de dinheiro (100 versus 100.00), semântica do novo indicador de progresso, alinhamento dos popovers após inclusão de filtros e quebra das ações de tabela em celular. Exportação foi verificada novamente com download real de Excel.
- Suíte: 163 testes de domínio/serviços passaram. A suíte completa de 57 cenários Chromium passou, incluindo os quatro novos fluxos de tabela/indicadores/galeria/autorização. Após compactar as colunas e concluir a persistência de mídia, oito cenários foram conferidos novamente, incluindo um novo teste da rota multipart (MIME inválido, tamanho excedido e Storage indisponível), todos aprovados. TypeScript e build passaram. Capturas da lista e galeria em desktop/celular foram inspecionadas; a revisão compactou as colunas principais e alinhou a contagem às bordas internas.
- A leitura autenticada dos buckets padrão/legado do Firebase Storage retornou 404. Upload está preparado e o site explica como ativar o Storage; não houve upload no bucket real. Fotos do ML funcionam independentemente dessa ativação. Publicação de fotos/vídeos pelo site no ML e consulta completa de Clips permanecem pendentes.

Uso e ativação do armazenamento: [listing-media.md](listing-media.md).

## Tarifas, diálogos e Google Drive — 14/10/2026

- A consulta real de precificação do anúncio informado retornou HTTP 429 (limitação temporária do ML). O servidor explica esse estado sem invalidar a conexão e não repete a consulta imediatamente. A precificação aceita tarifa individual e lista, preservando a validação da decomposição; taxas não são inventadas quando a API falha. A interface mantém o cálculo local imediato, reutiliza cotações válidas por cenário/versão/autorização e aplica uma pausa de um minuto após 429.
- Confirmações de exclusão e alterações ML usam diálogos acessíveis do site. Cancelar/Escape preservam campos e formulário; descarte precisa de confirmação explícita. O teste de retorno do navegador confirmou a rota e os campos preservados ao cancelar e a saída correta ao confirmar, inclusive para formulário de um módulo filho. O registro de alterações fica no provedor persistente para funcionar entre rotas. Recarregar/fechar a aba conserva o aviso nativo, exigido pelo navegador.
- Google Drive configurável por loja, com Client ID/segredo criptografado, URI exibida, PKCE, estado/cookie de uso único, consentimento offline, identidade validada e pasta privada criada pelo aplicativo. Credenciais não aparecem em consultas públicas ou recarga do formulário. O navegador percorreu cancelamento real pela rota OAuth sem recarregar a tela principal ou perder a loja.
- Os testes Drive exercitam envio, reprodução/Range, remoção, isolamento de loja, versões, papéis, confirmação de upload com retorno perdido, identidade dos arquivos e preservação de refresh token omitido na renovação. IDs reservados e checksum verificam o conteúdo; nenhuma conta Drive real foi conectada e nenhum arquivo de teste foi enviado ao Google.
- Resultado: **170 testes de domínio/serviços e 61 testes Chromium passaram**, sem ignorados. Build de produção e TypeScript passaram. A suíte inicial identificou falhas no método HTTP do formulário e na proteção ao voltar entre rotas; ambas foram corrigidas e exercitadas na suíte completa aprovada. A revisão visual do formulário Drive em desktop/celular compactou a ajuda inicial e alinhou o botão de copiar a URI.

O Drive substitui a ativação do Firebase Storage indicada na revisão anterior. Metadados/banco continuam no Firestore; arquivos anexados são rascunhos e não são publicados automaticamente no ML. Procedimento de ativação: [listing-media.md](listing-media.md).

**Conferência após publicação:** o commit `ba8252b` foi publicado com sucesso na Vercel. As consultas públicas do Google Drive e do armazenamento responderam 200, com a URI `https://datamat-ml.vercel.app/api/google-drive/callback` e estado não configurado verdadeiro. A cotação do anúncio informado pelo operador respondeu 200: preço **R$ 135,00**, tarifa **12% + R$ 0,00**, total **R$ 16,20**, validade de cinco minutos. Esta consulta registrou a cotação operacional no Firestore e não alterou o preço no Mercado Livre. A leitura administrativa confirmou zero rascunhos de mídia ativos na base real, portanto não houve arquivos antigos a migrar do Firebase Storage. Depois do ajuste visual do formulário, três cenários Chromium adicionais passaram novamente.

## Hoje compacta: anúncios, preços e desempenho

- Oito testes novos de domínio/serviço cobrem preparação versus urgência, pausas voluntárias, margem/estoque/proposta reunidos em um anúncio, vendedor/autorização/idade do retrato, queda com base mínima, exclusão de referências e decisões de anúncios encerrados, horário de Brasília, resposta mínima/isolamento e comparação até o menor horário efetivamente consultado. Um teste adicional de analytics garante que a consulta reduzida usa somente pedidos e que a consulta completa busca os dados operacionais mesmo depois desse cache.
- Quatro novos testes Chromium exercitam cinco linhas por página, indicadores com menos de 100 px, abertura direta dos custos, retorno à mesma loja/página, navegação das prioridades pelo teclado, adiamento por uma hora com recarga/expiração, formulário carregado sob demanda e persistência da tarefa conferida pelo SDK. Também verificam 320/390/768/1024/1440 px e retorno à posição de rolagem no celular.
- O teste da rotina foi atualizado para a resposta específica de Hoje: consulta automática única, loading sem remover vendas existentes, falha preservando loja/grupo e pausa impedindo novas consultas. O teste de skeleton intercepta tanto o workspace quanto o relatório da Hoje. A estrutura de carregamento conserva a classe comum e recolhe a área de gráfico no celular.
- Capturas `today-compact-*` e `today-live-compact-*` ficam em `test-results/`, ignoradas pelo Git. As séries do cenário ao vivo são controladas; os testes não enviam preços ao ML real. Mudanças externas passam a alimentar a seção opcional desde a primeira observação desta versão.
- A paginação é visual, com cinco anúncios por página. A consulta inicial continua lendo projeções dos registros das lojas selecionadas para calcular os indicadores; não é paginação por cursor no Firestore. A resposta evita notas, catálogo completo, atributos, histórico e snapshots de propostas. Formulários buscam o workspace completo apenas quando abertos.

**Resultado desta revisão:** 179 testes de domínio/serviços e 65 testes Chromium passaram, sem falhas ou ignorados; TypeScript, build de produção e formatação passaram. A revisão inicial identificou a interceptação antiga e a classe comum ausente do novo skeleton; ambos foram corrigidos antes da suíte completa final. As capturas com dados disponíveis e sem consulta foram inspecionadas em desktop/celular.

**Conferência em produção:** o commit `87219b4` foi publicado com sucesso na Vercel. A página e `GET /api/today?store=juntos-data` responderam 200. Com os mesmos 56 anúncios próprios pausados, o workspace retornou 547.179 bytes e Hoje 33.326 bytes, redução de **93,9% na resposta JSON**, sem alegação equivalente sobre tempo de carregamento. O relatório mostrou zero urgências/revisões e 56 anúncios em Preparar; a consulta de vendas disponível/completa informou zero pedidos pagos. A fila permaneceu na loja selecionada, sem catálogo completo, notas, histórico ou propostas na resposta. A conferência fez somente leituras, sem inserir dados sintéticos nem enviar mudanças ao ML.

Uso e critérios: [daily-operation.md](daily-operation.md).

## Hoje com detalhes úteis e carregamento sem bloqueios

- Carteira com ativos/pausados/rascunhos e atalhos para os filtros; custos completos/recentes, ticket médio, unidades e contribuição estimada com cobertura explícita. Zero e dados desconhecidos permanecem distintos. Os anúncios mostram preço/situação/código, motivo/evidência e margem/piso/estoque somente quando utilizáveis. Ícones, cores, gradientes discretos e preenchimento do gráfico recuperam a hierarquia visual; movimento reduzido desativa as transições dos cartões.
- O spinner global ocupa espaço reservado no cabeçalho, sem barra verde ou mensagem flutuante. Consultas automáticas usam atividade de fundo; o botão Atualizar ML mantém texto e largura, trocando somente o ícone. A consulta automática de catálogo carrega os novos dados sem bloquear os controles, descarta respostas durante edição e preserva o conteúdo em falhas. Consultas do workspace são canceladas ao navegar ou trocar de loja.
- Um novo teste de domínio verifica ocultação de estoque antigo e de estimativas com custos vencidos. Os testes existentes conferem campos financeiros pendentes, cobertura de custos por loja, contribuição desconhecida e evidência distinta de proposta. **180 testes de domínio/serviços passaram**, sem falhas ou ignorados; build de produção e TypeScript passaram.
- **66 cenários Chromium passaram na suíte completa**, incluindo um novo caso de navegação deixando uma requisição pendente, spinner sem texto/barra, manutenção das vendas durante atualização, consulta de catálogo com GET atrasado sem desabilitar campos/loja, proteção de rascunhos e responsividade das telas existentes.
- Depois da inspeção visual, o espaçamento superior foi reduzido e campos longos receberam limites de largura. **12 cenários Chromium passaram na conferência final**, incluindo um novo caso de anúncio com margem negativa e proposta aprovada: a visão de decisões mostra a evidência da proposta em vez do problema financeiro. São 67 cenários distintos exercitados nesta revisão. A volta da ficha preserva também a posição da rolagem interna da fila. Capturas desktop/celular foram inspecionadas, com dados controlados; testes usam emulador isolado.
