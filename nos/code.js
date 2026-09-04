/* A.I.S. — Nó Code (JavaScript custom) */
AISNodes.register({
  type:"code", name:"Code", desc:"Executa JavaScript customizado",
  category:"Dados", color:"#6B7280", trigger:false,
  icon:`<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/></svg>`,
  fields:[
    {key:"code",label:"Código",type:"textarea",placeholder:"// 'input' contém os dados de entrada\n// Atribua o resultado a 'result'\nresult = { ...input, processado: true };",rows:10},
  ],
  defaults:{code:'// input = dados de entrada\n// result = dados de saída\nresult = input;'}
});
