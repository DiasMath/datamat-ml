# Revisão funcional da versão atual

**Resultado:** versão básica viável para gestão manual no ambiente existente, agora sem login próprio, com Excel e listas de altura limitada. Cadastro, edição/exclusão permitida, custos, simulações, propostas, aprovação/confirmação manual, ações, notas e histórico foram exercitados. OAuth, importação, tarifas por cenário, métricas por período e notificações ML foram implementados e testados com respostas controladas; a ativação real depende da publicação e autorização. Bling, escrita externa, portal e extensão permanecem pendentes.

## Evidências

| Verificação                             | Resultado                                                                   |
| --------------------------------------- | --------------------------------------------------------------------------- |
| TypeScript e build de produção          | Passaram                                                                    |
| Domínio/serviços com Firestore Emulator | **77 testes passaram**                                                      |
| Navegador sobre build de produção       | **27 testes passaram**                                                      |
| Layout                                  | **90 combinações**: 15 telas/abas em 320, 360, 390, 768, 1024 e 1440 pixels |
| Dependências de produção                | **0 vulnerabilidades reportadas**                                           |
| Formatação                              | Código, scripts, testes e documentos verificados com Prettier               |

Os testes verificam os documentos Firestore diretamente pelo SDK, além de usar a interface. Projetos de teste `demo-*` são isolados e não recebem credenciais do projeto operacional. O CRUD real verificado na revisão anterior usou um documento técnico temporário removido ao terminar; nenhum cadastro demonstrativo foi acrescentado à operação.

## Módulos e mudanças

| Módulo        | Resultado desta revisão                                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Acesso        | Login, cadastro inicial, token, senhas locais, logout e gestão de usuários removidos. `/login` redireciona. Operador único definido no servidor; novos eventos guardam seu nome |
| Hoje          | Mantém pendências e ações úteis, sem acrescentar indicadores fictícios                                                                                                          |
| Anúncios      | Rolagem vertical/horizontal interna, cabeçalho fixo, páginas de 20/50/100, filtros e retorno pela URL. Seleção continua entre páginas, limitada a 100 para operação em lote     |
| Ficha         | Abas, produto compartilhado, composição, conteúdo, custos, propostas, tarefas/notas e histórico; catálogo reutilizado ao abrir/fechar a ficha                                   |
| Precificação  | Motor decimal, valores desconhecidos, revisão, snapshots e bloqueio de versões antigas mantidos; importação não burla o fluxo de preço                                          |
| Ações e notas | CRUD auditado, vínculo e conversão preservados; rolagem limitada e paginação independente                                                                                       |
| Histórico     | Registros anteriores/novos preservados, filtro no fuso de São Paulo, rolagem e páginas independentes                                                                            |
| Configurações | Lojas, parâmetros, integrações e registros; administração local de usuários retirada                                                                                            |
| Excel         | .xlsx e CSV, modelo vazio, escolha de aba, mapeamento sugerido, prévia de até 1.000 linhas e cadastro/atualização protegidos por ID/versão                                      |
| Lotes         | Transações de até 40, progresso, retomada e idempotência; resposta perdida após gravação não duplica registros                                                                  |
| Exportação    | Excel de todo o conjunto filtrado, com preço numérico, SKUs textuais e IDs/versões; CSV/JSON preservados                                                                        |

A inicialização do banco é memorizada por instância e falhas permitem nova tentativa. Paginar, ordenar e alternar abas não dispara nova leitura do catálogo. Operações ou atualização explícita renovam o cache local. Isso reduz leituras repetidas e elementos renderizados, mas não substitui consultas paginadas no banco.

## Usabilidade e responsividade

Mantida a identidade DATAMAT, com navegação curta, ações principais claras, ficha por abas e detalhes avançados recolhidos na importação. Listas maiores não alongam indefinidamente a página. Controles de paginação cabem em celular; tabelas preservam as colunas com rolagem interna. Erros da importação aparecem no próprio diálogo, evitando aviso duplicado.

Os testes percorrem 15 telas/abas em seis larguras e formulários/diálogos em celular e desktop, com títulos e links longos. Inspeção visual das capturas da lista de anúncios em 1440 e 390 pixels confirmou hierarquia, leitura e paginação acessível. Capturas ficam em `test-results/review/`. Essa verificação não substitui uma rodada de uso diário com dados próprios e testes em aparelhos físicos.

## Para usar e para concluir

1. Conferir parâmetros, custos e dados reais; importar/cadastrar anúncios e usar o fluxo manual. A proposta exige executar a alteração fora do site e registrar a confirmação com evidência.
2. Conectar o contexto do portal antes da publicação externa. Hoje todos os acessos usam o mesmo responsável; não há identificação individual nem sessão do portal implementada.
3. Publicar na Vercel e ativar/validar o OAuth ML nas contas reais; completar frete, promoções, variações individuais e escrita suportada. Bling, IA e Power BI automático dependem de adapters/pipeline. A presença das credenciais não significa conta autorizada.
4. Configurar HTTPS, hospedagem, `APP_URL`, backup/restauração e consultas por cursor para grande volume. A primeira leitura ainda carrega os registros das lojas selecionadas.
5. Desenvolver a extensão integrada em etapa posterior, conforme a [matriz Avantpro](avantpro.md). A pesquisa foi pública, sem afirmar equivalência Free/Pro já validada.

Arquivos grandes são confirmados em lotes: se um lote posterior falhar, os anteriores permanecem. Para retomar automaticamente, mantenha o diálogo aberto. Atualização por Excel não altera preço, dados compartilhados ou composição; use os fluxos correspondentes da ficha.

Comandos e limites completos: [README](../README.md), [validação](validation.md), [Firebase](firebase.md) e [roadmap](roadmap.md).

## Instância atual com Firebase real

Servidor reiniciado na porta 3000 e verificado após a mudança: `/` responde 200, `/login` redireciona para `/`, `/api/auth` responde 404 e `/api/workspace` responde 200 sem sessão. A consulta real retornou o operador configurado e duas lojas, sem anúncios, tarefas ou notas fictícios. Essa checagem não gravou dados operacionais.

## Precificação ao digitar e autocomplete

Preço/desconto, contribuição ML e custos previstos agora atualizam imediatamente no navegador com o mesmo motor decimal usado pelo servidor. O botão Calcular cenário foi retirado. Campos vazios/ inválidos não exibem resultado antigo. A proposta pode incluir custos digitados ainda não salvos, sem alterar o cadastro atual antes da decisão. Revisão e aplicação continuam conferindo versões, dados completos e condições ML.

Foi corrigido o arredondamento do desconto máximo para baixo, com quatro casas visíveis, e acrescentados avisos de contribuição negativa/preço abaixo do mínimo. Retirar uma substituição específica de taxa volta à herança da loja em todas as etapas. Preço atual, custos atuais e retratos anteriores são preservados até a ação explícita correspondente.

Autocomplete foi acrescentado à busca e aos campos recorrentes de catálogo, tarefas e notas, usando somente textos existentes e mantendo entrada livre. Não sugere números financeiros nem vincula produto por SKU. A [revisão das fórmulas](pricing.md) distingue a rotina manual de uma precificação ML conectada completa; a [pesquisa de recursos](research-mercado-livre.md) registra fontes e prioridades para os próximos módulos.

Na tela de cenário, custos ficam no painel de edição junto ao preço/desconto. No desktop, a comparação tem rolagem interna e permanece visível ao percorrer os campos; a contribuição aparece antes do detalhamento dos custos. Em telas menores, o layout usa uma coluna com resumo de preço e contribuição que permanece visível durante a edição.

## Integração ML e melhorias da pesquisa

Implementados OAuth com PKCE/state de uso único, tokens protegidos/renovados no servidor, catálogo com checkpoint por lote, consulta de tarifas por cenário, métricas agregadas por intervalo e notificações como sinais não verificados. Checklist cria uma tarefa por pendência aberta; prioridades de Hoje elevam margem negativa e problemas críticos observados. Publicidade tem indicadores manuais ao digitar. A configuração Vercel, exclusão de segredos e validador de variáveis estão prontos; deploy não executado. Ver [integrações](integrations.md) e [Vercel](vercel.md).
