# Nós do A.I.S.

Cada arquivo aqui define **um tipo de nó**. Todos são carregados automaticamente pelo editor.

## Como criar um novo nó

Crie um arquivo `.js` nesta pasta e chame `AISNodes.register({...})`:

```js
/* A.I.S. — Nó Meu Serviço */
AISNodes.register({
  type:"meuServico",              // identificador único
  name:"Meu Serviço",             // aparece na paleta
  desc:"Descrição curta",         // aparece na paleta e no card
  category:"Ações",               // Gatilhos | Ações | Dados | Lógica | Outros
  color:"#10B981",                // cor do ícone
  trigger:false,                  // true = gatilho (sem porta de entrada)
  icon:`<svg viewBox="0 0 24 24">...</svg>`,
  fields:[
    // campos que aparecem no painel de configuração
    {key:"apiKey", label:"Chave da API", type:"password"},
    {key:"acao",   label:"Ação",         type:"select",
      options:[{value:"a",label:"A"},{value:"b",label:"B"}]},
  ],
  defaults:{ apiKey:"", acao:"a" }
});
```

**Depois** registre o arquivo em `editor.html` (na lista de `<script src="nos/...">`).

Se o nó exigir lógica de execução no servidor, adicione o `case` correspondente em `server/engine.js`.

## Tipos de campo suportados

- `text`, `password`, `number`, `textarea`
- `select` com `options`

Cada campo pode ter `showIf: {chave: valor}` para aparecer só quando outro campo tem determinado valor (ex.: campos de "Basic Auth" que só aparecem se `auth === "basic"`).
