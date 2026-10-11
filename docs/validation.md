# Validação da versão atual

Ambiente cloud: Node.js 24, Next.js 16.4, React 19.3, Java 21 e Chromium. Esta revisão inclui integração ML no código, checklist/prioridades, métricas/indicadores de publicidade e preparação Vercel, além de cálculo ao digitar, autocomplete, login removido e Excel. Testes de negócio usam projetos aleatórios `demo-*` no emulador Firestore e não escrevem cadastros na base operacional `datamat-ml`.

| Verificação              | Resultado                                                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript               | `npm run typecheck`: passou                                                                                                                               |
| Domínio e serviços       | `npm test`: **77 passaram**, nenhuma falha ou teste ignorado                                                                                              |
| Build de produção        | `npm run build`: passou                                                                                                                                   |
| Navegador Chromium       | `npm run test:e2e`: **27 passaram**, nenhuma falha ou teste ignorado                                                                                      |
| Formatação               | Prettier em código, scripts, testes e documentação: passou                                                                                                |
| Dependências de produção | `npm audit --omit=dev`: **0 vulnerabilidades reportadas**                                                                                                 |
| Responsividade           | 15 telas/abas × 6 larguras: **90 combinações**, sem transbordamento horizontal do documento                                                               |
| Firestore real           | CRUD técnico isolado confirmado na revisão anterior; acesso atual sem login: `/api/workspace` 200 no Firebase real, duas lojas e nenhum cadastro fictício |

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

OAuth/catálogo/tarifas/métricas ML foram implementados e testados com respostas controladas. Não foram autorizadas contas reais nem validados contratos/permissões na aplicação ML do usuário: API/documentação retornaram HTTP 403 neste ambiente. Bling, IA, deploy público, portal, backup/restauração, pipeline Power BI e extensão permanecem pendentes. Regras publicadas do projeto real já negam acesso direto de clientes; índices versionados não foram publicados. Paginação é visual: a consulta inicial ainda carrega os registros das lojas selecionadas. Importação com vários lotes preserva os lotes concluídos, sem atomicidade do arquivo inteiro.

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
