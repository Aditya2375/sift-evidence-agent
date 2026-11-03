import { timingSafeEqual } from "crypto";

// Fail closed until the operator provisions a private access token. This is an
// access boundary, not a durable distributed rate limiter or billing budget.
export function accessGate(req: Request): Response | null {
  const secret=process.env.SIFT_ACCESS_TOKEN;
  if(!secret || secret.length<32)return Response.json({error:"Model-backed demo is paused until private access is configured."},{status:503});
  const token=req.headers.get("authorization")?.replace(/^Bearer /i,"")||"";
  const a=Buffer.from(token),b=Buffer.from(secret);
  if(a.length!==b.length||!timingSafeEqual(a,b))return Response.json({error:"Private demo access required."},{status:401});
  const origin=req.headers.get("origin");
  if(origin&&origin!==new URL(req.url).origin)return Response.json({error:"Cross-origin request refused."},{status:403});
  return null;
}
export async function boundedBody(req: Request): Promise<Record<string,unknown>> {
  if(!req.headers.get("content-type")?.includes("application/json"))throw Error("JSON required");
  if(Number(req.headers.get("content-length"))>8192)throw Error("Body too large");
  const reader=req.body?.getReader();if(!reader)throw Error("Body required");
  let total=0;const chunks:Uint8Array[]=[];
  try{for(;;){const {value,done}=await reader.read();if(done)break;total+=value.length;if(total>8192){await reader.cancel();throw Error("Body too large")}chunks.push(value)}}finally{reader.releaseLock()}
  const body=JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if(!body||typeof body!=="object"||Array.isArray(body))throw Error("Object required");
  return body;
}
// Conservative lexical guard. Database credentials must ALSO be read-only.
// Reject comments, quoted identifiers, multiple statements, unknown tables,
// procedural calls and advanced syntax rather than promise a full SQL parser.
export function validateReadSql(input:string):string{
  const sql=input.trim().replace(/;$/,"");
  if(sql.length>6000||!/^SELECT\s/i.test(sql)||/;|--|\/\*|\*\/|`|"|\\|\u0000/.test(sql))throw Error("Only one restricted SELECT is allowed");
  const code=sql.replace(/'(?:''|[^'])*'/g,"''");
  if(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|MERGE|COPY|CALL|EXEC|EXECUTE|GRANT|REVOKE|TRUNCATE|INTO|UNION|WITH|LOAD|SAVE|REFRESH|SET|SHOW|DESCRIBE|EXPLAIN|JDBC|HTTP|READ_CSV|READ_JSON|PARQUET|FILE|SLEEP)\b/i.test(code))throw Error("SQL outside read-only demo scope");
  const from=code.split(/\bFROM\b/i)[1]?.split(/\b(WHERE|GROUP|ORDER|HAVING|LIMIT)\b/i)[0]||"";
  if(from.includes(","))throw Error("Comma joins are not allowed");
  const refs=[...code.matchAll(/\b(?:FROM|JOIN)\s+([^\s,()]+)/gi)].map(m=>m[1].toUpperCase());
  const allowed=new Set(["LENDING.BORROWERS","LENDING.LOANS","LENDING.PAYMENTS","LENDING.FIELD_NOTES"]);
  if(!refs.length||refs.some(t=>!allowed.has(t))||/\bFROM\s*\(|\bJOIN\s*\(|,\s*LENDING\./i.test(code))throw Error("Table outside the demo allowlist");
  const functions=[...code.matchAll(/\b([A-Z_][A-Z_0-9]*)\s*\(/gi)].map(m=>m[1].toUpperCase());
  const safe=new Set(["COUNT","SUM","AVG","MIN","MAX","ROUND","COALESCE","CAST","LOWER","UPPER","SUBSTRING","TRIM","ABS","IN","NOT","AND","OR"]);
  if(functions.some(f=>!safe.has(f)))throw Error("Function outside the demo allowlist");
  return sql;
}
