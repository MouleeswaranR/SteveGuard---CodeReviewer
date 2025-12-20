import { Button } from "@/components/ui/button";
import { requireAuth } from "@/module/auth/utils/auth-utils";
import Logout from "@/module/auth/components/logout"
import Image from "next/image";

export default async function Home() {
  await requireAuth()
  return (
  <div className="flex flex-col items-center justify-center h-screen">
    
    <Logout>
      <Button>Logout</Button>
    </Logout>
  </div>
  );
}
