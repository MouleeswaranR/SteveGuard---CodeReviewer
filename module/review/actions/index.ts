"use server";

import prisma from "@/lib/db";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";


export async function getReviews(){
    const session=await auth.api.getSession({
        headers:await headers()
    })

    if(!session){
        throw new Error("Unauthorized")
    }

    const reviews=await prisma.review.findMany({
        where:{
            repository:{
                userId:session.user.id
            }
        },
        include:{
            repository:true
        },
        orderBy:{
            createdAt:'desc'
        },
        take:50
    });
    return reviews;
}
