/* A.I.S. — Nó IF (condicional) */
AISNodes.register({
  type:"if", name:"IF", desc:"Condição verdadeiro/falso",
  category:"Lógica", color:"#F97316", trigger:false,
  icon:`<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M6 9v3a6 6 0 0 0 6 6h3"/><path d="M6 9a6 6 0 0 0 6-3h3"/></svg>`,
  fields:[
    {key:"field",label:"Campo",type:"text",placeholder:"body.status"},
    {key:"operator",label:"Operador",type:"select",options:[
      {value:"equals",label:"Igual a"},{value:"notEquals",label:"Diferente de"},{value:"contains",label:"Contém"},
      {value:"gt",label:"Maior que"},{value:"lt",label:"Menor que"},{value:"gte",label:"Maior ou igual"},{value:"lte",label:"Menor ou igual"},
      {value:"exists",label:"Existe"},{value:"notEmpty",label:"Não está vazio"}]},
    {key:"value",label:"Valor",type:"text",placeholder:"sucesso"},
  ],
  defaults:{field:"",operator:"equals",value:""}
});
