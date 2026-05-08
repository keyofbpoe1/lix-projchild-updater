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
// Get OAuth Token
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
// Run GraphQL
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

  if (res.data.errors) {
    console.error(JSON.stringify(res.data.errors, null, 2));
    throw new Error("GraphQL failed");
  }

  return res.data.data;
}

// ======================================================
// Query: Parent + Children + Progress
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
// Calculate Overall Progress
// ======================================================
function calculateOverallProgress(project) {
  const edges = project.relToChild?.edges || [];

  const children = edges
    .map(edge => edge.node.factSheet)
    .filter(child => child);

  const total = children.length;

  let sumProgress = 0;

  const formattedChildren = children.map(child => {
    const progress =
      child.projectStatus?.edges?.[0]?.node?.progress ?? 0;

    sumProgress += progress;

    return {
      id: child.id,
      name: child.name,
      progress
    };
  });

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
    const factSheetId = req.body?.factSheet?.id;

    if (!factSheetId) {
      return res.status(400).send("Fact sheet ID missing");
    }

    const token = await getAccessToken();

    const project = await getProjectWithChildren(factSheetId, token);

    if (!project) {
      return res.status(200).send("Not a Project");
    }

    // ✅ Calculate overall progress
    const stats = calculateOverallProgress(project);

    const todayISO = new Date().toISOString().split("T")[0];

    // ✅ Build description
    const description = `${stats.totalChildren} child projects with an average completion of ${stats.overallProgress}%. This value is calculated as the mean of all child project progress values, with missing progress treated as 0%.`;

    // ✅ Build statusValue
    const statusValue = JSON.stringify({
      date: todayISO,
      description,
      progress: stats.overallProgress
    });

    // ✅ Run mutation
    await updateProjectStatus(factSheetId, statusValue, token);

    // ✅ Response
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