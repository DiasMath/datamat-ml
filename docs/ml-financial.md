# Custos e condições do Mercado Livre

A rotina da Hoje e do catálogo consulta até cinco anúncios próprios por execução. Reutiliza snapshots válidos por até 30 minutos, ordena os pendentes pela última tentativa, reserva a execução por loja e respeita o prazo restante da função. Falhas recebem espera de cinco minutos; consultar indicadores ou enviar IDs a `POST /api/financials/refresh` permite uma consulta explícita. Não envia preços nem adere a campanhas.

As fontes são mantidas em `ml_financials`, separadas de `costs`. Campos ML vazios (percentual, cobrança fixa e frete) usam a consulta válida; um valor manual, inclusive zero, continua sendo uma exceção explícita. Mercadoria, embalagem, impostos, publicidade e outros custos não são inventados nem sobrescritos. Atualizar o ML não renova a data de revisão dos custos próprios.

O snapshot pertence à organização, loja, anúncio, vendedor e autorização. Preço, categoria, modalidade, moeda, logística, gratuidade, dimensões e atributos de peso/tamanho vinculam a consulta ao contexto comercial. Mudança desse contexto, desconexão, outra organização ou expiração impedem o uso automático. Uma falha preserva o último snapshot compatível sem prolongar sua validade. Custos efetivos alterados pela sincronização incrementam a versão do anúncio e registram histórico; resposta que chega após edição não sobrescreve o rascunho salvo.

## Recursos consultados

- `GET /items/{item_id}` confirma o anúncio próprio e suas condições atuais.
- `GET /sites/MLB/listing_prices` consulta percentual e cobrança fixa para o preço/categoria/modalidade. Componentes que não reconciliam com o total exigem conferência.
- `GET /users/{seller_id}/shipping_options/free?item_id=...&item_price=...` consulta a referência de frete grátis. `coverage.all_country.list_cost` é usado como cotação estimada em BRL, sem subtrair novamente percentuais promocionais. Só entra automaticamente como custo do anúncio com frete grátis confirmado; ausência de gratuidade não prova custo zero para o vendedor. Não representa conciliação da cobrança de um envio realizado.
- `GET /items/{item_id}/sale_price?context=channel_marketplace` informa preço vigente e regular disponíveis. Divergência com o cadastro é indicada para conferência.
- `GET /seller-promotions/items/{item_id}?app_version=v2` informa campanhas e participação disponível. Elegível não significa ativa; participação percentual do ML não é convertida em subsídio monetário presumido.

O navegador calcula ao digitar e consulta novamente após 600 ms. A cotação do cenário dura cinco minutos, usa o preço digitado e identifica frete estimado, promoções e consultas indisponíveis. Propostas guardam a fonte de frete automático; o servidor substitui valores financeiros automáticos adulterados pelos da cotação vinculada. Aplicar preço no ML consulta novamente tarifa/frete e bloqueia mudança de frete automático ou promoção ativa. Confirmar uma aplicação preserva campos automáticos como fontes atualizáveis, em vez de congelá-los como custos manuais.

Dados de componentes opcionais indisponíveis ficam identificados, sem descartar tarifas válidas nem produzir frete/subsídio zero. Sem tarifa verificável, a cotação automática falha e permanece disponível a escolha explícita de condições manuais. Não há novas variáveis de ambiente: usa a integração configurada por loja no próprio site.

## Limites

Conciliação de frete efetivamente cobrado por envio, repasses, descontos efetivos, devoluções, estornos, Full e publicidade continuam separados desta cotação por anúncio. Não há gestão/adesão automática a promoções. O valor após tarifa e frete é uma estimativa anterior aos demais custos e ajustes financeiros. Preço mínimo e desconto máximo continuam estimados com as condições do cenário e exigem nova consulta no preço escolhido.

A ficha, a lista, a Hoje, os cálculos de análises, a verificação por regras e a consulta de custos da extensão compartilham a resolução dessas fontes. O cadastro e o Excel de custos próprios permanecem separados dos snapshots consultados; preencher manualmente um campo ML é uma exceção explícita à fonte automática.
