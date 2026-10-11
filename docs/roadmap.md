# Pendências para conclusão

**Login removido.** O site abre diretamente, sem cadastro inicial, senhas locais ou saída própria. O contexto atual usa um responsável único definido no servidor. A identidade individual e permissões do portal existente ainda precisam ser conectadas.

## Já entregue nesta revisão

- Rolagem limitada e paginação de 20/50/100 para anúncios, ações, notas, histórico, registros e prévia de importação.
- Menos consultas repetidas ao paginar, ordenar, alternar abas e abrir/fechar fichas.
- Excel .xlsx e CSV: arquivos de até 1.000 linhas, mapeamento, seleção de aba, prévia, cadastro e atualização por ID/versão.
- Exportação Excel de todo o conjunto filtrado; modelo vazio; custos e histórico preservados nas atualizações.
- Lotes de até 40, retomada e proteção contra reenvio duplicado.
- Cálculos ao digitar, prévia de custos não salvos, propostas com custos previstos e autocomplete de campos recorrentes.
- OAuth ML por loja, proteção/renovação dos tokens, importação em lotes, consulta de tarifas por preço, métricas por período e notificações, testados com respostas controladas; ativação real pendente.
- Checklist que vira tarefa, prioridades operacionais explicáveis, indicadores de publicidade manuais e configuração de publicação na Vercel.
- Pesquisa de ML, Real Trends, Nubimetrics, Avantpro e Bling com [prioridades por módulo](research-mercado-livre.md).
- Pesquisa pública do Avantpro e [referência e extensão implementada](avantpro.md), com limitações da comparação Free/Pro registradas.

## Ordem de conclusão

| Prioridade | Entrega               | Critério de conclusão                                                                                                                                                                  |
| ---------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1          | Contexto do portal    | Identidade verificada pelo servidor, organização, lojas e papéis; responsável/aprovador individual no histórico. Definir rota, módulo ou iframe e o contrato de sessão correspondente  |
| 2          | Mercado Livre         | Ativar e validar OAuth/importação/tarifas/métricas nas duas contas reais; completar variações individuais, frete, promoções e escrita após aprovação                                   |
| 3          | Bling                 | OAuth, correspondências de produtos/ofertas e definição de quem controla preço, estoque e conteúdo; evitar sobrescritas concorrentes                                                   |
| 4          | Dados e escala        | Atualização agendada/eventos, renovação de tokens, falhas controladas, busca indexada, paginação por cursor e agregações no Firestore. Medir leituras, duração e custo com volume real |
| 5          | Publicação e operação | HTTPS, domínio, segredos, contexto de acesso do portal, backup e restauração verificada; validação do fluxo com dados reais. Power BI automático exige pipeline próprio                |
| 6          | Extensão DATAMAT      | Captura, concorrência, histórico observado e acompanhamento integrados ao site; expandir segundo a matriz Avantpro, com APIs/fontes confirmadas                                        |
| 7          | Recursos avançados    | IA, tendências, testes A/B, imagens e publicador: somente após fluxo principal e dados confiáveis; sugestões sempre revisáveis                                                         |

## O que falta para iniciar a rotina manual

Conferir dados financeiros, cadastrar/importar anúncios reais e integrar/publicar pelo portal. A versão atual permite gestão manual no ambiente existente: cadastro, edição/exclusão permitida, custos, simulação, proposta, aprovação, confirmação, ações, notas e histórico. Preço de anúncio individual elegível pode ser aplicado por API após aprovação; demais alterações ML/Bling continuam externas com confirmação manual.

Para concluir a rotina conectada, faltam a ativação/validação real do ML, frete/promoções, escrita de conteúdo/estoque e variações, Bling e expansão da extensão. O Excel não substitui sincronização. A paginação visual não limita a leitura inicial do banco; bases grandes exigem consultas por cursor.

Dados necessários: anúncios/SKUs reais, custos/impostos/margens e base da comissão, aplicações/autorização ML e Bling, contrato do portal e eventual relatório/pipeline BI. Ver [review.md](review.md), [validation.md](validation.md) e [integrations.md](integrations.md).

A preparação da Vercel está documentada em [vercel.md](vercel.md). O recebimento de notificações inclui processamento verificado em segundo plano; cron diário exige CRON_SECRET compartilhada; o processamento grande de pedidos, publicidade por API, conciliação e preços individuais de variação permanecem pendentes.

## Rotina integrada entregue

Skeletons, toasts com relógio único, Hoje com vendas/margens/estoque/tarefas, processamento de notificações, aplicação de preço aprovado com conferência e concorrência com primeira extensão própria. Ver [fontes e limites](daily-operation.md).

## Tabelas e ações em lote entregues

Ordenação por cabeçalho, largura ajustável/restaurável, edição local e exclusão elegível em lote e ativação/pausa de anúncios próprios por API com conferência. Inserção continua pelo Excel. Publicar novos anúncios, enviar conteúdo/estoque e excluir anúncios reais por API permanecem pendentes. Ver [tabelas e operações em lote](tables-and-bulk.md).

## Diagnóstico e interface compacta entregues

Topo menor, opções de dropdown estilizadas com comportamento nativo e fallback, campanhas registradas/importadas com análise e tarefas, crescimento/queda de anúncios, competição opcional do catálogo, análise de termos/rascunhos e retrato de mídia/ficha atualizado. Product Ads automático, todos os Clips, causalidade/experimentos, ranking e publicação/IA/editor permanecem no roteiro descrito em [intelligence.md](intelligence.md) e [avantpro.md](avantpro.md).
