import express from "express";
import axios from "axios";
import "dotenv/config";

const app = express();
app.use(express.json());

const {
  LEANIX_BASE_URL,
  LEANIX_CLIENT_ID,
  LEANIX_CLIENT_SECRET,
  PORT = 3000
} = process.env;

// ======================================================
// Get OAuth Token from LeanIX
// ======================================================
async function getAccessToken() {
  const res = await axios.post(
    `${LEANIX_BASE_URL}/services/mtm/v1/oauth2/token`,
    new URLSearchParams({
      grant_type: "client_credentials",
      client_id: LEANIX_CLIENT_ID,
      client_secret: LEANIX_CLIENT_SECRET
    }),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      }
    }
  );

  return res.data.access_token;
}

// ======================================================
// Generic GraphQL runner
// ======================================================
async function runGraphQL(query, variables, token) {
  const res = await axios.post(
    `${LEANIX_BASE_URL}/services/pathfinder/v1/graphql`,
    { query, variables },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    }
  );

  // Handle GraphQL errors
  if (res.data.errors) {
    console.error(JSON.stringify(res.data.errors, null, 2));
    throw new Error("GraphQL failed");
  }

  return res.data.data;
}

// ======================================================
// Query: Get parent project + its children + progress
// ======================================================
async function getProjectWithChildren(factSheetId, token) {
  const query = `
    query ($id: ID!) {
      factSheet(id: $id) {
        ... on Project {
          id
          name
          relToChild {
            edges {
              node {
                factSheet {
                  ... on Project {
                    id
                    name
                    projectStatus {
                      edges {
                        node {
                          progress
                          description
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const data = await runGraphQL(query, { id: factSheetId }, token);
  return data.factSheet;
}

// ======================================================
// Calculate overall progress + build child data
// ======================================================
function calculateOverallProgress(project) {
  const edges = project.relToChild?.edges || [];

  const children = edges
    .map(edge => edge.node.factSheet)
    .filter(child => child);

  const total = children.length;
  let sumProgress = 0;

  // Format each child project
  const formattedChildren = children.map(child => {
    const statusNode = child.projectStatus?.edges?.[0]?.node;

    // Default progress = 0 if missing
    const progress = statusNode?.progress ?? 0;

    // Default description if missing
    const description =
      statusNode?.description ??
      "0 applications related to this project (0%) have been marked as completed.";

    sumProgress += progress;

    return {
      id: child.id,
      name: child.name,
      progress,
      description
    };
  });

  // Calculate average progress
  const overall =
    total === 0 ? 0 : Math.round(sumProgress / total);

  return {
    totalChildren: total,
    overallProgress: overall,
    children: formattedChildren
  };
}

// ======================================================
// Mutation: Update Project Status
// ======================================================
async function updateProjectStatus(factSheetId, statusValue, token) {
  const mutation = `
    mutation ($id: ID!, $patches: [Patch]!) {
      updateFactSheet(id: $id, patches: $patches) {
        factSheet {
          id
          ... on Project {
            projectStatus {
              edges {
                node {
                  id
                }
              }
            }
          }
        }
      }
    }
  `;

  const variables = {
    id: factSheetId,
    patches: [
      {
        op: "replace",
        path: "/projectStatus",
        value: statusValue
      }
    ]
  };

  await runGraphQL(mutation, variables, token);
}

// ======================================================
// Webhook Endpoint
// ======================================================
app.post("/leanix-webhook", async (req, res) => {
  try {
    // Extract Fact Sheet ID from webhook payload
    const factSheetId = req.body?.factSheet?.id;

    if (!factSheetId) {
      return res.status(400).send("Fact sheet ID missing");
    }

    // Step 1: Authenticate
    const token = await getAccessToken();

    // Step 2: Fetch parent + children
    const project = await getProjectWithChildren(factSheetId, token);

    if (!project) {
      return res.status(200).send("Not a Project");
    }

    // Step 3: Calculate statistics
    const stats = calculateOverallProgress(project);

    const todayISO = new Date().toISOString().split("T")[0];

    // ======================================================
    // Build Sub-Project Breakdown List
    // ======================================================
    const childDetails = stats.children
      .map(
        c =>
          `- ${c.name}: ${c.progress}% — ${c.description}`
      )
      .join("\n");

    // ======================================================
    // Build Final Description (includes list of children)
    // ======================================================
    const description = `${stats.totalChildren} child projects with an average completion of ${stats.overallProgress}%.
This value is calculated as the mean of all child project progress values, with missing progress treated as 0%.

Sub-project breakdown:
${childDetails}`;

    // ======================================================
    // Build Project Status Payload
    // ======================================================
    const statusValue = JSON.stringify({
      date: todayISO,
      description,
      progress: stats.overallProgress
    });

    // Step 4: Update parent project status
    await updateProjectStatus(factSheetId, statusValue, token);

    // Step 5: Return response
    res.status(200).json({
      projectId: project.id,
      projectName: project.name,
      totalChildren: stats.totalChildren,
      overallProgress: stats.overallProgress,
      description
    });

  } catch (err) {
    console.error(err.message);
    res.status(500).send("Error processing project");
  }
});

// ======================================================
// Start Server
// ======================================================
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});