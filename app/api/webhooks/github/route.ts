import { NextResponse,NextRequest } from "next/server";


export async function POST(req:NextRequest){
    try {
        const body=await req.json();
        const event=req.headers.get("x-github-event");

        if(event==="ping"){
            return NextResponse.json({message:"Pong"},{status:200})
        }

        return NextResponse.json({message:"Event Processes"},{status:200})
    } catch (error) {
        console.error("Error Processing Webhook:",error);
        return NextResponse.json({error:"Internal Server Error"},{status:500});
        
    }
}