import {Octokit} from "octokit";
import { auth } from "@/lib/auth";
import prisma from "@/lib/db";
import { headers } from "next/headers";

// getting github access token

export const getGithubToken=async()=>{
    const session=await auth.api.getSession({
        headers:await headers()
    })
    if(!session){
        throw  new Error("Unauthorized")
    }

    const account=await prisma.account.findFirst({
        where:{
            userId:session.user.id,
            providerId:"github"
        }
    })

    if(!account?.accessToken){
        throw new Error("No github access token found")
    }

    return account.accessToken;
}


export async function fetchUserContributions(token: string, username: string) {
    const octokit = new Octokit({ auth: token });

    // Calculate dates for the last year (explicitly for reliability)
    const today = new Date();
    const oneYearAgo = new Date(today);
    oneYearAgo.setFullYear(today.getFullYear() - 1);

    const query = `
    query($username: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $username) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                date
                contributionCount
                color
              }
            }
          }
        }
      }
    }
    `;

    try {
        const response: any = await octokit.graphql(query, {
            username,
            from: oneYearAgo.toISOString(),
            to: today.toISOString(),
        });

        return response.user.contributionsCollection.contributionCalendar;
    } catch (error) {
        console.error("Error fetching contributions:", error);
        return null;
    }
}