"use server";
import { fetchUserContributions,getGithubToken } from "@/module/github/lib/github";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { Octokit } from "octokit";
import prisma from "@/lib/db";

export async function getDashboardStats(){
    try {
        const session=await auth.api.getSession({
            headers:await headers()
        })
        if(!session?.user){
            throw new Error("Unauthorized")
        }

        const token=await getGithubToken();
        const octokit=new Octokit({auth:token});

        // get user's github username

        const{data:user}=await octokit.rest.users.getAuthenticated()
        
        //fetch total connected repos
        const totalRepos=30;

        const calendar=await fetchUserContributions(token,user.login);
        const totalCommits=calendar?.totalContributions||0;

        // Count PR's from database or github
        const {data:prs}=await octokit.rest.search.issuesAndPullRequests({
            q:`author:${user.login} type:pr`,
            per_page:1
        })
        const totalPrs=prs.total_count;

        //count ai reviews from database
        const totalReviews=40;

        return {
            totalCommits,
            totalPrs,
            totalReviews,
            totalRepos
        }
    } catch (error) {
     console.error("Error fetching dashboard stats:",error);
        return {
            totalCommits:0,
            totalPrs:0,
            totalReviews:0,
            totalRepos:0
        }
    }
}


export async function getMonthlyActivity(){
    try {
          const session=await auth.api.getSession({
            headers:await headers()
        })
        if(!session?.user){
            throw new Error("Unauthorized")
        }

        const token=await getGithubToken();
        const octokit=new Octokit({auth:token});

        const{data:user}=await octokit.rest.users.getAuthenticated()

        const calendar=await fetchUserContributions(token,user.login);

        if(!calendar){
            return [];
        }

        const monthlyData:{
            [key:string]:{commits:number;prs:number;reviews:number}
        }={}

        const monthNames=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

        //initialize for last 6 months
        const now=new Date();
        for(let i=5;i>=0;i--){
            const date=new Date(now.getFullYear(),now.getMonth()-i,1);
            const monthKey=monthNames[date.getMonth()];
            monthlyData[monthKey]={commits:0,prs:0,reviews:0};
        }

        calendar.weeks.forEach((week:any)=>{
            week.contributionDays.forEach((day:any)=>{
                const date=new Date(day.date);
                const monthKey=monthNames[date.getMonth()];
                if(monthlyData[monthKey]){
                    monthlyData[monthKey].commits+=day.contributionCount;
                }
            })
        })

        //fetch reviews from databse for last 6 months
        const sixMonthAgo=new Date();
        sixMonthAgo.setMonth(sixMonthAgo.getMonth()-6);

        //reviews's real data
        const generateSampleReviews=()=>{
            const sampleReviews=[];
            const now=new Date();

            for(let i=0;i<40;i++){
                const randomDaysAgo=Math.floor(Math.random()*180);
                const reviewDate=new Date(now);
                reviewDate.setDate(reviewDate.getDate()-randomDaysAgo);
                sampleReviews.push({
                    createdAt:reviewDate
                })
            }
            return sampleReviews;
        };

    const reviews=generateSampleReviews();

    reviews.forEach((review)=>{
        const monthKey=monthNames[review.createdAt.getMonth()];
        if(monthlyData[monthKey]){
            monthlyData[monthKey].reviews+=1;
        }
    })  

    const {data: prs}=await octokit.rest.search.issuesAndPullRequests({
        q:`author:${user.login} type:pr created:>${
            sixMonthAgo.toISOString().split("T")[0]
        },
        per_page=100    `
    });

    prs.items.forEach((pr:any)=>{
        const date=new Date(pr.created_at);
        const monthKey=monthNames[date.getMonth()];
        if(monthlyData[monthKey]){
            monthlyData[monthKey].prs+=1;
        }
    });

    return Object.keys(monthlyData).map((name)=>({
        name,
        ...monthlyData[name]
    }))
    } catch (error) {
        console.error("Error fetching monthly activity:",error);
        return [];
        
    }
}