"use server";
import { fetchUserContributions,getGithubToken } from "@/module/github/lib/github";
import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { Octokit } from "octokit";
import prisma from "@/lib/db";

export async function getContributionStats() {
    try {
        const session = await auth.api.getSession({
            headers: await headers()
        });
        if (!session?.user) {
            throw new Error("Unauthorized");
        }

        const token = await getGithubToken();
        const octokit = new Octokit({ auth: token });

        const { data: user } = await octokit.rest.users.getAuthenticated();
        const username = user.login;

        const calendar = await fetchUserContributions(token, username);

        if (!calendar) return null;

        const contributions = calendar.weeks.flatMap((week: any) =>
            week.contributionDays.map((day: any) => ({
                date: day.date,
                count: day.contributionCount,
                level: day.contributionCount === 0 ? 0 : Math.min(4, Math.floor((day.contributionCount - 1) / 5) + 1), // Optional: better level scaling if needed
            }))
        );

        return {
            contributions,
            totalContributions: calendar.totalContributions
        };
    } catch (error) {
        console.error("Error fetching contribution stats:", error);
        return null;
    }
}

export async function getDashboardStats() {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });
    if (!session?.user) {
      throw new Error("Unauthorized");
    }

    const userId = session.user.id;

    const token = await getGithubToken();
    const octokit = new Octokit({ auth: token });

    const { data: user } = await octokit.rest.users.getAuthenticated();

    // Total repositories the user has access to (owned + collaborated + org)
    // GitHub API paginates at 100 per page, so we need to fetch all pages
    let totalReposFromGitHub = 0;
    let page = 1;
    while (true) {
      const { data: repos } = await octokit.rest.repos.listForAuthenticatedUser({
        per_page: 100,
        page,
        sort: "created",
        direction: "desc",
      });

      if (repos.length === 0) break;

      totalReposFromGitHub += repos.length;
      page++;

      // Optional: safety break if too many (GitHub limits are high, but prevents infinite loop)
      if (page > 100) break; // Adjust if needed (most users have <1000 repos)
    }

    // Contribution calendar for total commits
    const calendar = await fetchUserContributions(token, user.login);
    const totalCommits = calendar?.totalContributions || 0;

    // Connected repositories in your app's database (repos the user explicitly connected for reviews)
    const totalConnectedRepos = await prisma.repository.count({
      where: { userId },
    });

    // Total AI reviews performed
    const totalReviews = await prisma.review.count({
      where: {
        repository: { userId },
      },
    });

    // Total PRs authored
    const { data: prs } = await octokit.rest.search.issuesAndPullRequests({
      q: `author:${user.login} type:pr`,
      per_page: 1,
    });
    const totalPrs = prs.total_count;

    return {
      totalCommits,
      totalPrs,
      totalReviews,
      totalRepos: totalReposFromGitHub,        // All repos in connected GitHub account
      totalConnectedRepos,                     // Repos explicitly connected in your app
    };
  } catch (error) {
    console.error("Error fetching dashboard stats:", error);
    return {
      totalCommits: 0,
      totalPrs: 0,
      totalReviews: 0,
      totalRepos: 0,
      totalConnectedRepos: 0,
    };
  }
}


export async function getMonthlyActivity() {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });
    if (!session?.user) {
      throw new Error("Unauthorized");
    }

    const userId = session.user.id;

    const token = await getGithubToken();
    const octokit = new Octokit({ auth: token });

    const { data: user } = await octokit.rest.users.getAuthenticated();

    const calendar = await fetchUserContributions(token, user.login);
    if (!calendar) return [];

    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    const monthlyData: {
      [key: string]: { commits: number; prs: number; reviews: number };
    } = {};

    // Initialize last 6 months
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthKey = monthNames[date.getMonth()];
      monthlyData[monthKey] = { commits: 0, prs: 0, reviews: 0 };
    }

    // Fill commits from contribution calendar
    calendar.weeks.forEach((week: any) => {
      week.contributionDays.forEach((day: any) => {
        const date = new Date(day.date);
        const monthKey = monthNames[date.getMonth()];
        if (monthlyData[monthKey]) {
          monthlyData[monthKey].commits += day.contributionCount;
        }
      });
    });

    // Fetch real reviews from database for last 6 months
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const reviews = await prisma.review.findMany({
      where: {
        repository: { userId },
        createdAt: { gte: sixMonthsAgo },
      },
      select: { createdAt: true },
    });

    reviews.forEach((review) => {
      const monthKey = monthNames[review.createdAt.getMonth()];
      if (monthlyData[monthKey]) {
        monthlyData[monthKey].reviews += 1;
      }
    });

    // Fetch PRs created in last 6 months
    const { data: prs } = await octokit.rest.search.issuesAndPullRequests({
      q: `author:${user.login} type:pr created:>${sixMonthsAgo.toISOString().split("T")[0]}`,
      per_page: 100,
    });

    prs.items.forEach((pr: any) => {
      const date = new Date(pr.created_at);
      const monthKey = monthNames[date.getMonth()];
      if (monthlyData[monthKey]) {
        monthlyData[monthKey].prs += 1;
      }
    });

    return Object.keys(monthlyData).map((name) => ({
      name,
      ...monthlyData[name],
    }));
  } catch (error) {
    console.error("Error fetching monthly activity:", error);
    return [];
  }
}