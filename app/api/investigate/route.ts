import { investigate } from "@/lib/agent";
import { accessGate, boundedBody } from "@/lib/safety";
export const runtime="nodejs";
export const maxDuration=300;
export async function POST(req:Request){
 const denied=accessGate(req);if(denied)return denied;
 let body:Record<string,unknown>;try{body=await boundedBody(req)}catch{return Response.json({error:"Valid JSON object required (8KB maximum)."},{status:400})}
 const question=body.question;
 if(typeof question!=="string"||!question.trim()||question.length>2000)return Response.json({error:"Question required, at most 2000 characters."},{status:400});
 const encoder=new TextEncoder();let canceled=false;
 const stream=new ReadableStream({async start(controller){
  const send=(e:unknown)=>{if(canceled||req.signal.aborted)throw Error("Request canceled");controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`))};
  try{await investigate(question,send)}catch{if(!canceled&&!req.signal.aborted)send({type:"error",data:"Investigation could not complete. No verified conclusion was produced."})}finally{if(!canceled)controller.close()}
 },cancel(){canceled=true}});
 return new Response(stream,{headers:{"Content-Type":"text/event-stream","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
}
