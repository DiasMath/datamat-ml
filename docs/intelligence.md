# Campanhas, diagnóstico e atualização dos anúncios

## Onde analisar campanhas

**Análises → Publicidade → Performance das campanhas.** Cadastre um relatório ou importe Excel .xlsx/CSV, confira a prévia e confirme. O modelo CSV abre no Excel. O importador lê a primeira aba, aceita os cabeçalhos do modelo e aliases comuns em português; não presume que qualquer formato de relatório ML seja compatível. Até 40 registros por confirmação, arquivo de até 2 MB, versão na atualização e uma chave estável por campanha/loja. Campos vazios permanecem desconhecidos. Exportar preserva chave, loja, período e versão para reimportação.

Um registro corresponde a uma campanha num intervalo completo. Não aceitamos períodos sobrepostos da mesma campanha, inclusive dentro de um lote: somá-los duplicaria resultados. O filtro inclui somente relatórios inteiramente contidos no intervalo e identifica os que cruzam a borda; não rateia receita/investimento. Atualização exige a versão exportada. O identificador e o período de um relatório existente são fixos; corrija um período errado excluindo o registro local e cadastrando o correto.

Indicadores decimais: ROAS, ACOS, CTR, CPC, CPO e contribuição estimada após publicidade, calculados enquanto você digita. A margem informada deve ser **antes de Ads** e incluir os demais custos. Contribuição = receita atribuída × margem antes de Ads − investimento; não é lucro líquido nem conciliação de repasses. Margem ausente não produz diagnóstico de rentabilidade positivo. Denominador zero torna a razão indisponível; receita atribuída zero e investimento positivo gera alerta.

Há alertas por ACOS acima da meta, contribuição estimada negativa, gasto sem receita atribuída, CTR abaixo de 0,5% com ao menos 1.000 impressões e ao menos 30 cliques sem pedidos atribuídos. Esses dois últimos são regras de triagem transparentes, não limites oficiais ou estatísticos do ML. A janela e o atraso de atribuição precisam de conferência antes de decidir. Uma tarefa de revisão da campanha é criada sem duplicação enquanto estiver aberta.

Totais indicam **relatórios registrados**, sem afirmar que todas as campanhas foram importadas. Receita atribuída não é somada à receita de vendas. TACOS do gasto registrado só aparece quando cada relatório cobre exatamente o filtro e a receita das lojas selecionadas está completa. Receita atribuída e pedidos usam janelas diferentes; não equivalem necessariamente aos pedidos criados no intervalo da análise.

Os cadastros, atualizações e exclusões têm controle de versão, lote atômico e histórico. Reenvio com a mesma operação não grava novamente. Excluir um relatório local preserva as tarefas e a auditoria e não exclui nem pausa uma campanha real. Nenhuma credencial adicional é necessária para os relatórios locais.

**Product Ads automático ainda não foi integrado.** Importar o relatório real é a fonte desta versão. As páginas oficiais de Product Ads não forneceram documentação utilizável nesta consulta; não foi inventado um contrato ou simulado um vínculo real. Orçamento, pausa/ativação de campanhas, atribuição automática e notificações de publicidade exigem integração/permissões específicas.

## Anúncios ganhando ou perdendo vendas

**Análises → Diagnóstico** cruza os anúncios próprios com as vendas do filtro e do período anterior equivalente. Exige dados completos, vendedor/autorização correspondentes e pelo menos cinco pedidos somando os períodos. Crescimento de receita ≥15% recebe “Ganhando vendas”; queda ≤−15%, “Perdendo vendas”; a faixa intermediária é estável. Sem base anterior ou amostra suficiente não inventamos um percentual.

Receita, receita anterior, variação, margem atual, qualidade e ajustes ficam em uma tabela ordenável, com rolagem e paginação. Crescimento de vendas pode coexistir com margem negativa. A margem usa custos atuais, não os custos históricos de cada venda. Qualidade ML mostra `health × 100` quando retornado, sem apresentar uma pontuação interna como oficial. As pendências usam estoque observado, campos faltantes e dados antigos; a comparação não identifica sozinha a causa da perda. A ficha já transforma verificações de qualidade em tarefas.

## Disputa do catálogo

**Ficha → Desempenho → Competição no catálogo → Consultar competição no ML.** Recurso opcional para anúncio próprio de catálogo em BRL. Consulta `/items/{id}/price_to_win?siteId=MLB&version=v2`, após verificar o anúncio/vendedor autorizado. Valida a identidade do retorno, mantém somente situação, preço indicativo, preço observado, consistência e data. Guarda o retrato ligado à versão do anúncio e autorização; snapshots de outro contexto não são usados.

Não inferimos vitória no catálogo a partir das vendas. Estados conhecidos são traduzidos; estados novos aparecem para conferência. Recurso/permissão indisponível recebe erro verdadeiro. O preço indicativo não é aplicado e não garante vitória: logística e outras condições influenciam a disputa. Se o valor estiver abaixo do piso estimado cadastrado, há um aviso na análise; outro preço exige revalidar custos/tarifas. Os contratos foram testados com respostas controladas; a API real ainda precisa ser conferida na conta autorizada. Referência: [competição no catálogo](https://developers.mercadolivre.com.br/pt_br/competicao-em-catalogo).

## Títulos e termos observados

**Ficha → Visão geral → Analisar título e termos da concorrência.** Rascunho com contagem de caracteres e verificações simples; termos das referências vinculadas, normalizados por acentos e contados por título distinto. A amostra vem dos registros capturados pelo site/extensão, até 40 títulos vinculados. Não é volume de busca, tendência do mercado inteiro ou ranking por palavra-chave. Não transferimos atributos de outros produtos automaticamente.

O rascunho pode ser copiado ou salvo como nota do anúncio. Não altera o conteúdo publicado nem usa um provedor de IA oculto. A atualização visual fica pausada enquanto houver edição não salva. O limite de 60 caracteres é uma indicação para conferir as regras da categoria, não uma restrição universal de publicação.

## Como alterações do ML chegam ao site

Notificações `items` acionam leitura oficial; a varredura periódica recupera mudanças sem notificação. O site consulta um lote de até 20 anúncios por loja a cada ciclo de 60 segundos após a consulta anterior, enquanto visível e sem edição/diálogo. Prioriza lojas menos recentemente consultadas e respeita reservas e checkpoints. Na ficha, consulta somente o anúncio aberto; **Consultar anúncio no ML** permite atualizar explicitamente. O prazo de um pedido é limitado; datasets grandes exigem vários ciclos. Não é um stream nem uma garantia de atualização instantânea de todo o catálogo.

Ao terminar, a interface relê o Firestore, preservando conteúdo enquanto carrega. Pausa em segundo plano, durante uma operação ou com rascunhos/diálogos abertos. Erros usam toasts e mantêm o último retrato identificado pela data. Atualizações não substituem campos que você está editando; uma gravação concorrente exige recarga por controle de versão. O número público da versão de autorização foi incluído na projeção para validar os vínculos de métricas, competição e operações ML; nenhum token foi exposto.

Além de título, preço, descrição, SKU e situação, registramos IDs/URLs HTTPS das fotos, ordem das fotos, atributos da ficha, dados de variações, estoque, `sub_status`, `health` e `video_id` quando retornados. Alterações de conteúdo/mídia/estoque aumentam a versão e registram antes/depois no histórico, mesmo que título e preço não tenham mudado. Custos, produto compartilhado, tarefas e decisões locais são preservados. URLs de imagens só usam HTTPS em `mlstatic.com`, sem credenciais na URL. A mídia/ficha pode ser expandida na visão geral.

Descrição/atributos indisponíveis são identificados; uma falha opcional não vira conteúdo vazio confirmado. `video_id` pertence ao retorno legado do anúncio: ausência desse campo é indisponibilidade. **Clips, todos os vídeos e campanhas têm APIs específicas e não estão cobertos por essa consulta.** Alterações desses recursos ainda não são refletidas automaticamente. O cron continua dependendo de `CRON_SECRET`; credenciais de lojas continuam configuradas pelo site.
