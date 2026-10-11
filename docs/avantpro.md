# Avantpro: referência funcional e futura extensão DATAMAT

Pesquisa das páginas públicas oficiais para **Mercado Livre**. A extensão paga não foi instalada nem exercitada; as funcionalidades abaixo são as anunciadas pelo fornecedor, não resultados de um teste próprio. A página comercial atual apresenta planos mensal/anual e combinações de marketplaces; não confirma uma matriz completa de Free versus Pro. Um endereço de ajuda cujo slug citava grátis/Pro/Ultra atualmente devolve conteúdo de onboarding e não sustenta essa divisão. A equivalência por plano deverá ser conferida na versão utilizada pelo cliente antes de fechar o escopo completo.

## Fontes consultadas

- [Avantpro para Mercado Livre](https://avantpro.com.br/ml/): funcionalidades e planos apresentados atualmente.
- [Mudanças da nova versão](https://avantpro.com.br/o-novo-avantpro/): ferramentas contextuais, personalização, Post, Analytics e Intelligence.
- [Download oficial](https://avantpro.com.br/baixar/): vínculo para a extensão ML.
- [Avantpro ML no Chrome Web Store](https://chromewebstore.google.com/detail/avantpro-ml/jdefnfmbnchmnjkcknaadaddgjbgephh): endereço obtido do download oficial. Nesta consulta a loja não forneceu descrição utilizável; não foi usada para afirmar recursos adicionais.
- [Ajuda de instalação](https://chat.avantpro.com.br/hc/ajuda/articles/1789481109-como-instalar-a-extensao-do-avantpro-e-realizar-o-login): extensão, ferramentas no marketplace e acesso ao produto.

## Recursos e aplicação na rotina

| Recurso anunciado                                           | Estado no DATAMAT                                                              | Aplicação proposta                                                                                                                            |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Calculadora de contribuição e precificação                  | Motor decimal, custos separados, propostas e confirmação manual implementados  | Reutilizar o mesmo motor na extensão, sem fórmulas financeiras divergentes                                                                    |
| Exportação Excel                                            | Importação/exportação .xlsx, modelo, prévia, atualização e lotes implementados | Exportar também estudos de concorrência quando esses dados existirem                                                                          |
| Interface limpa, dados ocultáveis e ferramentas contextuais | Navegação simples, ficha por abas, listas com rolagem/paginação implementadas  | Colunas opcionais e painel lateral contextual; avançados fora da tela diária                                                                  |
| Concorrência da primeira e demais páginas                   | Referências manuais e notas; nenhuma coleta automática                         | Capturar ofertas comparáveis, vendedor, preço, frete/tipo quando disponíveis, posição, URL e data; salvar estudo separado do catálogo próprio |
| Histórico de preços                                         | Histórico interno de alterações implementado                                   | Acrescentar série temporal de concorrentes com fonte e data; não inferir histórico anterior à coleta                                          |
| Central de monitoramento Hype                               | Tarefas e prioridades manuais                                                  | Lista de acompanhamento, alertas úteis e transformação em tarefa/proposta; definir frequência, limiares e fontes antes de automatizar         |
| Ranqueamento e palavras-chave para títulos                  | Conteúdo próprio editável, sem análise automática                              | Registrar posição por consulta/data, comparar termos e sugerir títulos para revisão                                                           |
| Visitas, conversão e desempenho com gráficos                | Aba preparada, dados externos indisponíveis                                    | Integrar métricas autorizadas das próprias lojas; dados privados de concorrentes não são presumidos acessíveis                                |
| Tendências e ProdutoPRO/compatibilidade                     | Não implementados                                                              | Estudos por categoria e critérios transparentes de oportunidade; definir amostra e explicar limitações de estimativas                         |
| Testes A/B de título/imagem                                 | Não implementados                                                              | Hipótese, versões, período e resultados; aplicação externa depende das capacidades e autorizações reais do ML                                 |
| Editor de fotos e geração de imagens                        | Não implementados                                                              | Ferramenta opcional com imagens próprias; guardar versões e revisão humana                                                                    |
| Código de barras                                            | Não implementado                                                               | Separar desenho do código de validade de um identificador comercial; validar padrão/origem exigidos pelo marketplace                          |
| Publicador com IA / Post                                    | Não implementado; somente cadastro local                                       | Rascunho guiado: ficha técnica, título/descrição, imagens, entrega e preço/tipo; revisão antes de publicar por integração autorizada          |
| Analytics e sugestões de melhoria com IA                    | Regras internas determinísticas; IA indisponível                               | Recomendações com evidências, parâmetros e período; converter sugestões em ações. Impacto previsto deve ser identificado como estimativa      |
| Títulos, descrição, melhoria de descrição e objeções com IA | Não implementados                                                              | Provedor no servidor, contexto verificável e aprovação do operador; conteúdo não altera fatos do produto                                      |
| App móvel                                                   | Site responsivo; nenhum app nativo                                             | Manter acesso móvel útil ao site; app independente somente se trouxer vantagem operacional                                                    |

A intenção é reproduzir as capacidades úteis em uma implementação própria, com identidade DATAMAT, código e componentes próprios. A interface diária continua concentrada em anúncios, pendências, custos, decisões e tarefas. Pesquisa, editor e IA entram como ferramentas opcionais, sem acrescentar cartões vazios ao início.

## Primeira entrega da extensão, em etapa posterior

**Fluxo principal:** abrir anúncio/pesquisa do Mercado Livre → abrir painel DATAMAT → selecionar juntos.com ou juntos.data → conferir captura → salvar referência ou vincular anúncio existente → abrir a ficha no site → criar tarefa/proposta quando necessário.

1. **Chrome Manifest V3:** painel lateral, script de conteúdo restrito às páginas suportadas e service worker. Permissões mínimas e hosts específicos; evitar acesso genérico a todo o navegador.
2. **Coleta assistida:** URL, código ML, título, preço e informações públicas disponíveis, com data, fonte e estado de coleta. Identidade de produto e loja exige conferência; SKU não é identidade única. Campos ausentes permanecem desconhecidos.
3. **Integração com o site:** API de captura com ID de operação, validação, prévia e deduplicação por loja/código ML. Referências de concorrentes ficam separadas das ofertas próprias. Nenhuma chave administrativa Firebase ou segredo ML/IA vai para a extensão.
4. **Contexto do portal:** token ou mecanismo verificado no servidor, com escopo e validade definidos. O contexto atual de operador único e a política `APP_URL` não constituem uma ponte pronta para uma origem `chrome-extension://`. Criar esse contrato antes de habilitar escrita pela extensão; não abrir CORS indiscriminadamente.
5. **Continuidade:** abrir no site preservando loja e referência; custos/propostas usam os serviços existentes. Retentativas não duplicam captura; filas mostram pendências e conflitos. Coleta não altera automaticamente preço, estoque ou conteúdo.
6. **Testes:** páginas suportadas e mudanças de layout, paginação de pesquisa, autorização, loja errada, respostas incompletas, reenvio, indisponibilidade, limpeza de tokens e confirmação no Firestore. Usar fixtures próprias e contas autorizadas para validar capacidades reais.

## Sequência para cobrir o conjunto completo

| Etapa | Entrega                                                                            | Dependência                                                                   |
| ----- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1     | Captura contextual, comparação de concorrência, exportação e vínculo site/extensão | Contrato do portal/API e fontes suportadas                                    |
| 2     | Histórico observado, acompanhamento, alertas, posição e palavras-chave             | Coleta recorrente confiável, consultas por cursor e retenção                  |
| 3     | Desempenho das lojas e recomendações baseadas em dados                             | OAuth ML, métricas autorizadas e séries temporais                             |
| 4     | Tendências, critérios de oportunidade e testes A/B                                 | Dados suficientes e controle das mudanças externas                            |
| 5     | Editor, rascunho de publicação, IA de conteúdo/imagem e Analytics                  | Uploads/armazenamento, provedor IA e publicação autorizada                    |
| 6     | Conferência de paridade Free/Pro na versão do cliente                              | Lista de recursos observados e acesso autorizado à experiência correspondente |

A extensão será desenvolvida depois; este documento não anuncia instalação, publicação ou paridade pronta. O escopo final pode incluir todos os recursos funcionais relevantes, mas a disponibilidade de dados e as APIs precisam ser confirmadas. Valores de visitas, vendas, conversão ou ganho potencial não serão inventados para preencher uma tela.
