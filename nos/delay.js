/* A.I.S. — Nó Delay (pausa) */
AISNodes.register({
  type:"delay", name:"Delay", desc:"Aguarda antes de continuar",
  category:"Lógica", color:"#EC4899", trigger:false,
  icon:`<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`,
  fields:[
    {key:"amount",label:"Tempo",type:"number",min:1,max:3600},
    {key:"unit",label:"Unidade",type:"select",options:[{value:"seconds",label:"Segundos"},{value:"minutes",label:"Minutos"}]},
  ],
  defaults:{amount:5,unit:"seconds"}
});
