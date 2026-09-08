/* A.I.S. — Nó HTTP Request */
AISNodes.register({
  type:"httpRequest", name:"HTTP Request", desc:"Faz chamadas a APIs externas",
  category:"Ações", color:"#10B981", trigger:false,
  icon:`<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>`,
  fields:[
    {key:"method",label:"Método",type:"select",options:["GET","POST","PUT","DELETE","PATCH"]},
    {key:"url",label:"URL",type:"text",placeholder:"https://api.exemplo.com/dados"},
    {key:"headers",label:"Headers (JSON)",type:"textarea",placeholder:'{"Authorization": "Bearer {{$input.token}}"}',rows:3},
    {key:"body",label:"Corpo (JSON)",type:"textarea",placeholder:'{"nome": "{{$input.nome}}"}',rows:4},
    {key:"timeout",label:"Timeout (segundos)",type:"number",min:1,max:300},
  ],
  defaults:{method:"GET",url:"",headers:"{}",body:"",timeout:30}
});
