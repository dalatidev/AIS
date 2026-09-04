/* A.I.S. — Nó Webhook (Gatilho HTTP) */
AISNodes.register({
  type:"webhook", name:"Webhook", desc:"Recebe requisições HTTP",
  category:"Gatilhos", color:"#8B5CF6", trigger:true,
  icon:`<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10A15 15 0 0 1 12 2Z"/></svg>`,
  fields:[
    {key:"method",label:"Método HTTP",type:"select",options:[{value:"GET",label:"GET"},{value:"POST",label:"POST"},{value:"PUT",label:"PUT"},{value:"DELETE",label:"DELETE"},{value:"PATCH",label:"PATCH"}]},
    {key:"path",label:"Caminho",type:"text",placeholder:"meu-webhook"},
    {key:"auth",label:"Autenticação",type:"select",options:[{value:"none",label:"Nenhuma"},{value:"basic",label:"Basic Auth"},{value:"header",label:"Header Auth"}]},
    {key:"basicUser",label:"Usuário",type:"text",showIf:{auth:"basic"}},
    {key:"basicPass",label:"Senha",type:"password",showIf:{auth:"basic"}},
    {key:"headerName",label:"Nome do header",type:"text",placeholder:"X-Api-Key",showIf:{auth:"header"}},
    {key:"headerValue",label:"Valor",type:"password",showIf:{auth:"header"}},
    {key:"responseMode",label:"Responder",type:"select",options:[{value:"immediately",label:"Imediatamente"},{value:"lastNode",label:"Quando o último nó terminar"}]},
    {key:"responseCode",label:"Código de resposta",type:"number",min:100,max:599},
    {key:"responseData",label:"Dados da resposta",type:"select",options:[{value:"allEntries",label:"Todas as entradas (JSON)"},{value:"firstEntry",label:"Primeira entrada"},{value:"noBody",label:"Sem corpo"}]},
  ],
  defaults:{method:"POST",path:"",auth:"none",basicUser:"",basicPass:"",headerName:"",headerValue:"",responseMode:"immediately",responseCode:200,responseData:"allEntries"}
});
