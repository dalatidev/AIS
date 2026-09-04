/* A.I.S. — Nó Set */
AISNodes.register({
  type:"set", name:"Set", desc:"Define ou transforma campos",
  category:"Dados", color:"#3B82F6", trigger:false,
  icon:`<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
  fields:[
    {key:"mode",label:"Modo",type:"select",options:[{value:"manual",label:"Campos manuais"},{value:"json",label:"JSON completo"}]},
    {key:"json",label:"JSON de saída",type:"textarea",placeholder:'{"campo": "{{$input.body.valor}}"}',rows:6,showIf:{mode:"json"}},
  ],
  defaults:{mode:"manual",json:"{}",values:[{key:"",value:""}]}
});
