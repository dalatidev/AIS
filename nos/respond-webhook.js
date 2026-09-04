/* A.I.S. — Nó Respond to Webhook */
AISNodes.register({
  type:"respondWebhook", name:"Respond to Webhook", desc:"Envia resposta HTTP ao chamador",
  category:"Ações", color:"#7C3AED", trigger:false,
  icon:`<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 17-5-5 5-5"/><path d="M4 12h11a4 4 0 0 1 0 8h-1"/></svg>`,
  fields:[
    {key:"responseCode",label:"Código HTTP",type:"number",min:100,max:599},
    {key:"body",label:"Corpo da resposta",type:"textarea",placeholder:'{"status": "ok", "dado": "{{$input.body.x}}"}',rows:5},
    {key:"headers",label:"Headers (JSON)",type:"textarea",placeholder:'{"X-Custom": "valor"}',rows:3},
  ],
  defaults:{responseCode:200,body:'{"status": "ok"}',headers:"{}"}
});
