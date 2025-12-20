"use client"

import React from 'react'
import { signIn } from '@/lib/auth-client'
import { useState } from 'react'
import { GithubIcon } from 'lucide-react';

const LoginUI = () => {
    const [isLoading,setIsLoading] =useState(false);
    const handleGithubLogin=async()=>{
        setIsLoading(true);
        try{
            await signIn.social({
                provider:"github"
            })
        }catch(error){
            console.error("Login error:",error)
            setIsLoading(false)
        }
    }
  return (
    <div className='min-h-screen bg-linear-to-br from-black via-black to-zinc-900 text-white dark flex'>
        {/* Left section */}
        <div className='flex-1 flex flex-col justify-center px-12 py-16'>
            <div className='max-w-lg'>
                <div className='mb-16'>
                    <div className='inline-flex items-center gap-2 text-2xl font-bold'>
                        <div className='w-8 h-8 bg-primary rounded-full'/>
                        <span>CodeReviewer</span>
                    </div>
                </div>
            {/* Main Content */}
            <h1 className='text-5xl font-bold mb-6 leading-tight text-balance'>
                Cut Code Review Time & Bugs in Half. <span className='block'>Instantly</span>
            </h1>
            <p className='text-lg text-gray-400 leading-relaxed'>
                Supercharge your team to ship faster with most advanced AI code reviews.
            </p>
            </div>
        </div>
        {/* Right Section - Login Form*/}
        <div className='flex-1 flex flex-col justify-center items-center px-12 py-16'>
            <div className='w-full max-w-sm'>
                <div className='mb-12'>
                    <h2 className='text-3xl font-bold mb-2'>Welcome Back</h2>
                    <p className='text-gray-400'>Login using one of the following providers: </p>
                </div>
                {/* Github login buttonL */}
                <button
                onClick={handleGithubLogin}
                disabled={isLoading}
                className='w-full py-3 px-4 bg-primary text-black rounded-lg font-semibold
                hover:bg-primary-foreground disabled:opacity-50 disabled:cursor-not-allowed
                transition-colors flex items-center justify-center gap-3 mb-8'   
                >
                <GithubIcon size={20}/>
                {isLoading?"Signing in...":"GitHub"}
                </button>

                {/* Footer Links */}
                <div className='space-y-4 text-center text0-sm text-gray-400'>
                    <div>
                        New to CodeRabbit?{" "}
                        <a href="#" className='text-primary hover:text-primary-foreground font-semibold'>
                            Sign Up
                        </a>
                    </div>
                    <div>
                        <a href="#" className='text-primary hover:text-primary-foreground font-semibold'>
                            Self-Hosted Services
                        </a>
                    </div>
                </div>
                {/* Bottom Links */}
                <div className='mt-12 pt-8 border-t border-gray-700 flex justify-center gap-4 text-xs text-gray-500'>
                    <a href="#" className='hover:text-gray-400'>Terms of Use</a>
                    <span>and</span>
                    <a href="#" className='hover:text-gray-400'>
                        Pricvacy Policy
                    </a>
                </div>
            </div>
        </div>
    </div>
  )
}

export default LoginUI