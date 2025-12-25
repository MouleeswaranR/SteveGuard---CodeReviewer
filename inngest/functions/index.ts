import prisma from "@/lib/db";
import { inngest } from "../client";
import { getRepoFileContents } from "@/module/github/lib/github";
import { indexCodebase } from "@/module/ai/lib/rag";



export const indexRepo=inngest.createFunction(
  {
    id:"index-repo"
  },
  {event:"repository.connected"},
  async({event,step})=>{
    const {owner,repo,userId}=event.data;

    //fetch all files in given repo
    const files=await step.run("fetch-files",async()=>{
      const account=await prisma.account.findFirst({
        where:{
          userId:userId,
          providerId:"github"
        }
      })
      if(!account?.accessToken){
        throw new Error("No Github access token found");
      }
      return await getRepoFileContents(account.accessToken,owner,repo);
    })
    await step.run("index-codebase",async()=>{
      await indexCodebase(`${owner}/${repo}`,files)
    })
    return {success:true,indexedFiles:files.length};
  }
)