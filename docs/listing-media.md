# Catálogo, fotos e vídeos

A lista possui as visões **Operacional ML** e **Cadastro**. A operacional mostra foto, estoque publicado, modalidade, frete, recebimento estimado, indicadores de sete dias, qualidade e situação. As colunas continuam ordenáveis, redimensionáveis e paginadas, com rolagem interna. O título visual é limitado a duas linhas; o texto completo aparece ao passar o ponteiro e na ficha.

**Contagem:** um registro corresponde a um ID ML da loja. Títulos iguais não são unidos, pois podem pertencer a publicações diferentes. O cabeçalho distingue IDs, títulos, catálogo e tradicionais; o filtro de publicação permite conferir cada grupo. Na leitura da conta juntos.data desta revisão, os 56 IDs eram únicos: 44 títulos distintos, 50 publicações de catálogo e seis tradicionais. Essa constatação não prova como o painel ML agrupa os produtos; não foram removidos anúncios ou fundidos custos.

**Consultar indicadores ML** consulta as ofertas filtradas, ou somente as selecionadas, em grupos de até cinco. A operação informa andamento e preserva filtros. Visitas e pedidos pagos usam o intervalo retornado para sete dias, sem misturar vendas acumuladas nem o cache de trinta dias da ficha. Falhas opcionais preservam dados já consultados. Recebimento é uma estimativa após tarifa oficial válida e frete cadastrado, antes de impostos, custos e ajustes: sem ambos, fica indisponível. Mudança de autorização e expiração de tarifa invalidam a projeção. A qualidade informada pelo ML é distinta do checklist próprio; experiência de compra não é inventada.

Clique na foto ou na aba **Fotos e vídeos** para abrir a galeria. As fotos já importadas aparecem imediatamente na lista, sem duplicar todo o conjunto de mídia no workspace. A primeira foto válida é usada como miniatura. A ficha permite ampliar imagens e visualizar vídeos legados com endereço reconhecido; referências sem endereço têm link para o anúncio. **Clips não são integralmente fornecidos pela API de anúncios usada aqui**: consulte-os no ML. Novas sincronizações atualizam a mídia publicada sem apagar rascunhos.

## Arquivos em rascunho

O upload aceita JPG, PNG, WebP, MP4 e WebM de até **3 MB por arquivo**, com até 30 arquivos por anúncio. São enviados individualmente para respeitar o limite de requisição da Vercel. O servidor valida assinatura/MIME, tamanho, organização, loja, permissão e versão. Metadados ficam no Firestore; os bytes ficam no Firebase Storage e são servidos pela API da aplicação, incluindo Range para vídeo. Envio idempotente, reserva de execução, limpeza de tentativas rejeitadas e exclusão auditada preservam a consistência. Rascunhos ativos precisam ser removidos antes da exclusão do cadastro local.

**Esses uploads não publicam nem substituem fotos/vídeos no Mercado Livre.** A área identifica claramente rascunho versus publicado. Envio direto ao ML, ordenação/substituição de fotos oficiais e upload de Clips precisam de contratos e permissões específicos e ainda não estão disponíveis.

O bucket padrão é `<FIREBASE_PROJECT_ID>.firebasestorage.app`; instalações com bucket próprio podem usar `FIREBASE_STORAGE_BUCKET`. A conta de serviço já configurada é reutilizada: não há chave por loja nem novo segredo para preencher.

Nesta revisão, os buckets padrão e legado do projeto retornaram **404** em leitura autenticada. Para ativar uploads:

1. Abra **Firebase Console → projeto datamat-ml → Storage** e configure o bucket padrão em modo de produção, mantendo o acesso direto de clientes restrito.
2. Garanta que a conta administrativa do sistema possa ler, criar e remover objetos nesse bucket.
3. Volte à ficha e recarregue a aba Fotos e vídeos. O botão de upload fica disponível quando a verificação confirma o armazenamento.

A interface mostra a pendência e o link para o console quando o bucket não está disponível. Fotos do ML continuam funcionando independentemente do Storage. Os testes usam emulador Firestore e armazenamento controlado; nenhum arquivo de teste foi enviado ao bucket real.
