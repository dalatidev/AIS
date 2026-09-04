/* A.I.S. — Nó Nota (comentário visual) */
AISNodes.register({
  type:"note", name:"Nota", desc:"Comentário visual (não executa)",
  category:"Outros", color:"#64748B", trigger:false,
  icon:`<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>`,
  fields:[{key:"text",label:"Texto",type:"textarea",placeholder:"Anotação sobre o fluxo...",rows:4}],
  defaults:{text:""}
});
