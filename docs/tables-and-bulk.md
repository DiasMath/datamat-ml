# Tabelas e operações em lote

## Cabeçalhos

Anúncios, Concorrência e seu histórico, vendas/margens e reposição de Hoje, produtos/lojas/dados dos gráficos em Análises e a matriz de responsabilidades compartilham os mesmos controles.

- Clique no nome de uma coluna para ordenar; clique novamente para inverter. Números, valores e datas usam seus valores originais. Dados desconhecidos ficam no final em ambas as direções.
- A ordenação ocorre sobre o conjunto carregado, antes da paginação, preservando a seleção por ID. Ordenar não consulta novamente o workspace no Firestore.
- Arraste a borda direita para ajustar entre 80 e 800 px. Duplo clique restaura a largura inicial. As larguras são salvas neste navegador por tabela, sem gravar dados no Firestore.
- Teclado: Tab até o separador, setas ajustam 10 px, Shift + seta ajusta 50 px e Home restaura. Cabeçalhos anunciam a direção para leitores de tela.
- Colunas de seleção e de ação têm largura fixa. A rolagem continua dentro da tabela, com cabeçalho fixo. A paginação visual continua baseada no conjunto carregado; bases grandes ainda exigem consultas por cursor.

## Inserção e edição

**Inserir em massa:** Anúncios → Importar → Excel/CSV → conferir prévia → confirmar. Até 1.000 linhas na prévia e lotes atômicos de 40; retomar não duplica registros. É cadastro no sistema, não publicação de anúncios no ML.

**Editar pela planilha:** exporte os registros, preserve ID e versão, altere os campos permitidos e importe como atualização. Preços seguem o fluxo de proposta/aprovação. Campos do produto compartilhado e composições continuam pela ficha.

**Editar selecionados:** marque até 100 anúncios e abra Ações em lote. Permite situação local, prefixo/sufixo do título e substituição explícita da descrição. As versões de todos são conferidas antes de gravar; um conflito impede o lote inteiro. Preço/custos não são alterados. A requisição tem ID idempotente para não repetir um prefixo após uma resposta perdida. Essas edições locais não enviam conteúdo/situação ao ML.

## Exclusão

Ações em lote → Excluir cadastros locais → confirmar. Até 40 rascunhos ou referências sem tarefas, notas ou propostas. Um item não permitido impede a exclusão de todo o lote; conjuntos com muitos registros auxiliares exigem seleção menor. Histórico de exclusão é preservado, custos/composição/simulações são removidos e o código ML é liberado. Referências acompanhadas são desvinculadas, mantendo seu histórico.

Anúncios em operação devem ser pausados ou encerrados no cadastro para preservar vínculos. **Excluir um cadastro local não exclui o anúncio no Mercado Livre.** Esta entrega não encerra nem exclui anúncios reais por API.

## Ativar e pausar no ML

Selecione anúncios próprios sincronizados de contas autorizadas → Ações em lote → Ativar/Pausar no Mercado Livre → confirmar. Há também um botão na ficha para uma oferta. A ativação exige estoque positivo confirmado no ML; estados diferentes de ativo/pausado precisam de conferência no marketplace.

O navegador processa grupos de cinco e apresenta resultado por anúncio. Cada item verifica loja, vendedor, autorização, versão e situação oficial, reserva o registro, envia no máximo um PUT e lê a confirmação. Falha em um item não é tratada como sucesso e não desfaz alterações já confirmadas nos outros. Não existe transação atômica para múltiplos anúncios na API do ML.

Conferir/retomar preserva os IDs das operações. Resposta incerta bloqueia uma nova ação naquele anúncio e só permite leitura para verificar. A recuperação também funciona após fechar/reabrir a tela, por meio da operação pendente guardada no Firestore, e quando uma notificação já observou o resultado. Uma nova autorização/vendedor incompatível exige revisão. Não há reenvio automático de um PUT incerto.

Situação confirmada, estoque observado quando disponível e auditoria são persistidos. A confirmação de estoque tem sua própria data; não torna todas as condições comerciais antigas artificialmente recentes. Preços aprovados ficam bloqueados enquanto há conferência de situação pendente.

Os contratos usam respostas controladas e Firestore isolado nos testes. Ativação/pausa em uma oferta real ainda precisa ser exercitada após a autorização do vendedor.
