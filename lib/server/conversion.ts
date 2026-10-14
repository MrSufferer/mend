export async function startConversion(orderId:string) {
 if(!process.env.CONVERSION_FUNCTION_URL||!process.env.CONVERSION_SERVICE_SECRET)return;
 try {await fetch(process.env.CONVERSION_FUNCTION_URL,{method:'POST',headers:{Authorization:`Bearer ${process.env.CONVERSION_SERVICE_SECRET}`,'Content-Type':'application/json'},body:JSON.stringify({orderId}),signal:AbortSignal.timeout(25000)});}
 catch {/* Invocation outcome unknown. The durable generation claim prevents another execution. */}
}
