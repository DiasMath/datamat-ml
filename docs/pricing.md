# Precificação: cálculo, interação e limites

A precificação funciona para **cenários manuais com os dados informados**. Preço, desconto, contribuição ML, custos e suas bases são recalculados ao digitar, usando o mesmo módulo decimal no navegador e no servidor. Não precisa Enter, sair do campo ou salvar para ver o resultado. Com a conta autorizada e o anúncio sincronizado, a tela consulta tarifas do ML após uma pausa de 600 ms e registra a consulta oficial na proposta. Frete e promoções continuam exigindo conferência. A ativação nas contas reais depende da publicação/credenciais; os testes desta integração usam respostas controladas.

## Como usar

Na ficha → Custos e preço ou na tela Precificação, selecione o anúncio e edite os números. Digitar `1` e depois `5`, formando `15`, produz dois resultados sucessivos. Campos vazios deixam resultados dependentes indisponíveis; `0` representa custo zero conhecido. Valores inválidos removem a prévia anterior e mostram o que corrigir.

O formulário de custos tem uma prévia ao preço atual. A comparação Atual × proposta usa o cadastro salvo na coluna atual e os custos digitados na coluna proposta. Tarifas/frete/publicidade específicos do cenário podem substituir os custos digitados; o seletor informa essa precedência. As bases e margens vêm da configuração da loja.

- **Digitar:** cálculo local, sem requests ou gravações por tecla.
- **Salvar custos:** atualiza o custo cadastrado, registra histórico e revisa a versão da oferta.
- **Salvar para revisão:** registra uma proposta com os custos digitados e os demais valores do cenário, sem mudar preço/custos atuais. O servidor recalcula e compara versões antes de aceitar.
- **Aplicar:** aprovação → solicitação → execução externa → confirmação manual. Confirmação grava preço/custos aprovados e preserva o snapshot. Preço ou tarifa/frete alterados exigem conferência; mudanças financeiras com pendências não são aplicadas.

A UI guarda estado de digitação e reenvios idempotentes; novas condições/motivo geram outra identidade de operação. Dados alterados em outra sessão ou parâmetros revisados invalidam a versão exibida. Voltar de uma alíquota específica de `0` para “Usar parâmetro da loja” remove a substituição, inclusive na proposta e após sua aplicação.

## Fórmulas auditadas

Definições: `P` = preço pago pelo comprador, depois do desconto e arredondado a centavos; `S` = contribuição/subsídio ML informado; `R = P + S`. Custos fixos por oferta `F` = mercadoria da oferta inteira + cobrança fixa ML + frete pago pela loja + embalagem + publicidade por venda + outros custos. São custos constantes **no cenário**, não despesas fixas da empresa.

- Tarifa ML = `P × taxaML`.
- Impostos = `baseImpostos × taxaImpostos`.
- Gestão = `baseGestão × taxaGestão`.
- Bases de impostos/gestão: `P` ou `R`, conforme a configuração. Cada base é independente.
- Custo total `C = F + tarifaML + impostos + gestão`.
- Contribuição por venda `M = R − C`.
- Contribuição percentual `M / R × 100`.
- Novo preço por desconto `P = arredondar(preçoAtual × (1 − desconto/100), 2)`.

Taxas entram como fração no cálculo; percentuais são divididos por 100. Decimal.js evita erros financeiros de ponto flutuante. Totais são calculados antes de arredondar; a soma de parcelas exibidas a centavos pode diferir um centavo do total, porque o total mantém a precisão intermediária.

O preço mínimo conservador para margem `m` é `F / (1 − taxaML − taxaImpostos − taxaGestão − m)`, sem subsídio promocional e supondo custos/taxas constantes. O resultado sobe ao próximo centavo e respeita piso de R$ 0,01. O preço desejado usa a margem desejada na mesma fórmula. Denominador zero/negativo significa condição inviável; não produz preço ou desconto fictício.

Desconto máximo = `(1 − preçoMínimo/preçoAtual) × 100`, disponível apenas quando o mínimo não supera o preço atual. É truncado para baixo a quatro casas decimais, e a tela mostra essa precisão: arredondar para cima pode violar o piso em tickets grandes. Esse limite continua **estimado**, porque o Mercado Livre pode mudar taxas/frete conforme a condição.

## Exemplo conferido independentemente

Valores ilustrativos de teste, sem afirmar que são as tarifas vigentes de uma categoria do ML: preço R$ 100, custos constantes R$ 50, tarifa ML 10%, impostos 5% sobre preço e gestão 1% sobre preço.

| Condição                                                    | Receita | Custo total | Contribuição | Contribuição % |
| ----------------------------------------------------------- | ------- | ----------- | ------------ | -------------- |
| Preço 100                                                   | 100,00  | 66,00       | 34,00        | 34%            |
| Preço 90                                                    | 90,00   | 64,40       | 25,60        | 28,4444%       |
| Preço 80 + contribuição ML 10; imposto/gestão sobre receita | 90,00   | 63,40       | 26,60        | 29,5556%       |

Com margem mínima de 10%, o mínimo conservador é R$ 67,57. Com margem desejada de 20%, R$ 78,13. Ao preço atual de R$ 100, o desconto máximo conservador é 32,4300%.

São testadas as quatro combinações de base para imposto/gestão, zeros explícitos, herança, campos desconhecidos, limites inviáveis, preço com centavos, desconto que gera fração de centavo, tickets até R$ 1 bilhão e mudança de custos sem mudar o preço. Contribuição negativa ou preço abaixo do mínimo gera aviso; o sistema não presume que reduzir preço aumenta vendas.

## O que ainda falta para uma precificação conectada completa

1. Validar a consulta de tarifas implementada na conta real e integrar frete por logística, peso/dimensões e regras vigentes. A consulta usa a categoria/modalidade reais e quantidade 1 para a unidade da oferta; não transforma o número de peças de um kit em quantidade de vendas. Mínimo/desconto permanecem estimados com tarifas constantes, sujeitos a nova consulta no preço escolhido.
2. Promoções oficiais: elegibilidade, preço-base, desconto financiado pela loja, contrapartida ML e validade. O subsídio atual é informado no cenário e preservado no snapshot; não existe atualização automática de uma promoção ativa.
3. Custos reais do Bling, composição calculada de kits, atualização por compras e política definida para custo médio/reposição. Hoje mercadoria representa a oferta inteira e é informada manualmente.
4. Importar gastos/receitas atribuídas da API de publicidade e definir provisão por venda. A calculadora manual de ROAS/ACOS/TACOS foi entregue em Desempenho, sem alterar custos ou somar receita atribuída ao total.
5. Conciliação com pedidos/recebimentos: tarifas efetivas, descontos, estornos, devoluções e custos de devolução. O valor mostrado é contribuição, **não lucro líquido nem saldo exato a receber**.
6. Comparação de cenários, alertas de margem após mudança de custos e sugestões de preço respeitando piso e aprovação. Nenhum preço é alterado automaticamente no ML nesta versão.

As fontes e prioridades de produto estão em [research-mercado-livre.md](research-mercado-livre.md); comandos e resultados em [validation.md](validation.md).

Na tela de cenário, custos ficam no painel de edição junto ao preço/desconto. No desktop, a comparação tem rolagem interna e permanece visível ao percorrer os campos; a contribuição aparece antes do detalhamento dos custos. Em telas menores, o layout usa uma coluna com resumo de preço e contribuição que permanece visível durante a edição.

## Consulta oficial por cenário

A tarifa é vinculada a oferta, preço, versão, vendedor e conexão, com validade de cinco minutos. O servidor aceita apenas percentual/fixo que reconciliem o total retornado e ignora tarifas adulteradas enviadas pelo navegador. Respostas de preços anteriores não atualizam o cenário novo. Se a consulta falhar, a interface bloqueia salvar no modo automático e permite escolher condições manuais explicitamente. A consulta verifica o anúncio próprio e mantém frete/subsídio separados; não marca todas as condições como conferidas apenas por consultar comissão. Ver [integrações](integrations.md).
