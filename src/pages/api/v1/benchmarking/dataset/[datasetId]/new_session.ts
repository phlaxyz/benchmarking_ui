import { NextApiRequest, NextApiResponse } from "next";
import {
  NewSession,
  NewSessionApiResponse,
  SessionListingApiResponse,
} from "@sine-fdn/sine-ts";
import { Dataset } from "@prisma/client";
import NewSessionSchema from "../../../../../../schemas/NewSession.schema";
import prismaConnection from "../../../../../../utils/prismaConnection";
import { PerformBenchmarking } from "../../../../../../mpc";

export default async function NewBenchmarkingSession(
  req: NextApiRequest,
  res: NextApiResponse<NewSessionApiResponse | SessionListingApiResponse>
) {
  if (req.method === "HEAD") {
    return res.status(200).end();
  }

  if (req.method === "POST" || req.method === "CREATE") {
    return await post(req, res);
  }

  return res.status(400).json({ success: false, message: "Bad Request" });
}

async function post(
  req: NextApiRequest,
  res: NextApiResponse<NewSessionApiResponse>
) {
  const datasetId = req.query.datasetId;
  if (typeof datasetId !== "string") {
    return res.status(400).json({ success: false, message: "Bad Dataset ID" });
  }

  const maybeNewSession = validateBody(req);
  if (!maybeNewSession) {
    return res
      .status(400)
      .json({ success: false, message: "Unrecognized Body" });
  }

  const maybeDataset = await verifyDataset(maybeNewSession, datasetId);
  if (!maybeDataset) {
    return res.status(400).json({
      success: false,
      message: "Unrecognized dimension or dataset id",
    });
  }

  const maybeId = await createSession(maybeNewSession, datasetId, ["", ""], 0);
  if (!maybeId) {
    return res.status(400).json({
      success: false,
      message: "Unable to create session at Database",
    });
  }

  PerformBenchmarking(maybeId);

  return res.status(201).json({
    success: true,
    id: maybeId,
  });
}

async function verifyDataset(
  session: NewSession,
  datasetId: string
): Promise<false | Dataset> {
  const dataset = await prismaConnection().dataset.findUnique({
    include: {
      dimensions: {
        select: { name: true },
      },
    },
    where: { id: datasetId },
  });
  if (!dataset) {
    console.error("Failed to find dataset", datasetId);
    return false;
  }

  /**
   * verify requested dimensions exist in the dataset
   */
  const reqSet = new Set(session.input.map((f) => f.title));
  const inSet = new Set(dataset.dimensions.map((d) => d.name));
  for (const dimension of reqSet) {
    if (!inSet.has(dimension)) {
      console.log(`Failed to find dimension ${dimension} in ${inSet}`);
      return false;
    }
  }

  return dataset;
}

async function createSession(
  data: NewSession,
  datasetId: string,
  processorHostnames: string[],
  numParties: number
): Promise<string | undefined> {
  const { title, input } = data;
  const inputTitles = input.map((d) => d.title);
  const inputComputations = input.map((d) => d.computation);

  try {
    const { id } = await prismaConnection().benchmarkingSession.create({
      select: {
        id: true,
      },
      data: {
        title,
        numParties,
        inputTitles,
        inputComputations,
        processorHostnames,
        dataset: { connect: { id: datasetId } },
        submissions: {
          create: [{ submitter: "You" }],
        },
      },
    });

    return id;
  } catch (error) {
    console.error("createSession", data, error);
    return undefined;
  }
}

function validateBody(req: NextApiRequest): NewSession | undefined {
  try {
    return NewSessionSchema.validateSync(req.body, { stripUnknown: true });
  } catch (error) {
    console.error("Unrecognized body: ", error);
    return undefined;
  }
}