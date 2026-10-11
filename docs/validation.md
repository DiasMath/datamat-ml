# Validação da versão atual

Ambiente cloud: Node.js 24, Next.js 16.4, React 19.3, Java 21 e Chromium. Esta revisão inclui integração ML no código, checklist/prioridades, métricas/indicadores de publicidade e preparação Vercel, além de cálculo ao digitar, autocomplete, login removido e Excel. Testes de negócio usam projetos aleatórios `demo-*` no emulador Firestore e não escrevem cadastros na base operacional `datamat-ml`.

| Verificação              | Resultado                                                                                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript               | `npm run typecheck`: passou                                                                                                                                |
| Domínio e serviços       | `npm test`: **110 passaram**, nenhuma falha ou teste ignorado                                                                                              |
| Build de produção        | `npm run build`: passou                                                                                                                                    |
| Navegador Chromium       | `npm run test:e2e`: **37 passaram**, nenhuma falha ou teste ignorado                                                                                       |
| Formatação               | Prettier em código, scripts, testes e documentação: passou                                                                                                 |
| Dependências de produção | `npm audit --omit=dev`: **0 vulnerabilidades reportadas**                                                                                                  |
| Responsividade           | 15 telas/abas × 6 larguras: **90 combinações**, sem transbordamento horizontal do documento                                                                |
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

OAuth/catálogo/tarifas/métricas ML foram implementados e testados com respostas controladas. Não foram autorizadas contas reais nem validados contratos/permissões na aplicação ML do usuário: API/documentação retornaram HTTP 403 neste ambiente. Bling, IA, inspeção autenticada das variáveis da publicação, portal, backup/restauração, pipeline Power BI e extensão permanecem pendentes. Regras publicadas do projeto real já negam acesso direto de clientes; índices versionados não foram publicados. Paginação é visual: a consulta inicial ainda carrega os registros das lojas selecionadas. Importação com vários lotes preserva os lotes concluídos, sem atomicidade do arquivo inteiro.

As fontes públicas do Avantpro foram pesquisadas, mas a experiência Free/Pro e a extensão paga não foram testadas. Veja [avantpro.md](avantpro.md), [roadmap.md](roadmap.md) e [README](../README.md).

## Revisão adicional da precificação

- Preço digitado `1` → `15` e custo `1` → `15`: contribuição atualizada a cada tecla, foco mantido, sem Enter/blur/salvar e sem request de mutação. O SDK confirmou preço e custos atuais intactos.
- Preço vazio/subcentavo, desconto `100%`, custos inválidos e campos desconhecidos não mantêm uma contribuição antiga como se ainda fosse válida.
- Quatro combinações de bases para impostos/gestão, contribuição ML, custos previstos completos e limites seguros de desconto em tickets grandes foram conferidos por exemplos independentes.
- Alterar taxas/frete com preço inalterado exige revalidação; voltar de alíquota específica zero à herança da loja funciona no cálculo, proposta e aplicação.
- Proposta global com custos não salvos tem snapshot recalculado no servidor e não modifica custo/preço atuais; aplicação aprovada persiste os custos propostos.
- Autocomplete reutiliza marca, modelo, categoria, produto/SKU, busca, tarefas/responsáveis e títulos de notas; aceita texto novo e preserva zeros em SKUs. Motor de sugestões verifica acentos, caixa, deduplicação e limite de opções.
- Precificação global verificada em 320/390/768/1440 pixels, além da revisão das 15 telas/abas em seis larguras. Capturas em `test-results/pricing-live-desktop.png` e `test-results/pricing-live-mobile.png`. No desktop, a contribuição permanece no viewport ao editar custos; no celular, o resumo acompanha a digitação.

Fórmulas e limites comerciais: [pricing.md](pricing.md). Pesquisa e fontes: [research-mercado-livre.md](research-mercado-livre.md).

## Mercado Livre e Vercel

- Tokens protegidos com AES-256-GCM, falha de integridade, URLs de retorno inválidas, state/cookie/PKCE, expiração/negação/reuso e isolamento de vendedores/lojas. Nenhum token aparece na projeção pública.
- Importação idempotente preserva custos/tarefas, registra mudanças reais e retoma a página interrompida sem repetir scan ou duplicar o anúncio. Condições comerciais invalidam propostas antigas mesmo se o preço não mudar. Variações com preços diferentes bloqueiam proposta agregada.
- Tarifa vinculada a preço/versão/vendedor, decomposição reconciliada, expiração, adulteração ignorada pelo servidor, alterações externas e renovação concorrente de token. Desconectar invalida consultas em andamento.
- Visitas e pedidos pagos do mesmo intervalo, pedidos duplicados/cancelados, receita bruta separada de recebimento, dados de compradores não persistidos e volumes incompletos não gravados como completos.
- Notificações deduplicadas em caixa limitada, rejeição de outra aplicação, recursos arbitrários descartados e nenhum preço alterado por payload.
- `vercel.json` sem erros de configuração segundo o schema oficial. Node.js 24.x fixado. Validador passou com o JSON administrativo e rejeitou origem localhost e falta do JSON para a hospedagem. Segredos não foram exibidos nem adicionados ao repositório.

Os testes Chromium da integração usam contratos controlados: consulta após pausa, respostas obsoletas descartadas, snapshot oficial preservado, modo manual explícito em falha, checklist/tarefa, publicidade ao digitar e responsividade em 320/390 pixels. Esse conjunto complementa a revisão de 90 combinações das telas existentes.

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

Permissões e contratos do ML real ainda precisam ser conferidos com a conta autorizada. Publicidade automática, conciliação, reclamações/devoluções e concorrência permanecem pendentes. Veja [analytics.md](analytics.md).

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
