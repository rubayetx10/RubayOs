/* eslint-disable @typescript-eslint/no-explicit-any */
import { Router } from 'express';
import type { Model } from 'mongoose';
import { z, type ZodTypeAny } from 'zod';
import { asyncHandler } from '../../common/asyncHandler';
import { AppError } from '../../common/errors';
import { sendSuccess } from '../../common/response';
import { validate } from '../../middleware/validate';
import { objectId } from './academic.schemas';

type Payload = Record<string, any>;

export interface CrudOptions {
  model: Model<any>;
  createSchema?: ZodTypeAny; // omit to disable POST (for example semesters are generated)
  updateSchema: ZodTypeAny;
  filterKeys: string[];
  /** Derive parent ids and validate parents before saving. */
  prepareCreate?: (data: Payload) => Promise<Payload>;
  /** Replace the default Model.create (for transactions). */
  create?: (data: Payload) => Promise<unknown>;
  prepareUpdate?: (existing: any, data: Payload) => Promise<Payload>;
}

export async function mustFind(model: Model<any>, id: string, label: string) {
  const doc = await model.findById(id);
  if (!doc) throw AppError.badRequest(`${label} not found`);
  return doc;
}

export function buildCrudRouter(opts: CrudOptions): Router {
  const router = Router();

  const listQuery = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    status: z.string().optional(),
    ...Object.fromEntries(opts.filterKeys.map((k) => [k, k.endsWith('Id') ? objectId.optional() : z.string().optional()])),
  });
  const idParams = z.object({ id: objectId });

  router.get(
    '/',
    validate({ query: listQuery }),
    asyncHandler(async (req, res) => {
      const q = req.validated!.query as Payload;
      const filter: Payload = {};
      for (const key of [...opts.filterKeys, 'status']) if (q[key] !== undefined) filter[key] = q[key];
      const [items, total] = await Promise.all([
        opts.model.find(filter).sort({ createdAt: 1 }).skip((q.page - 1) * q.limit).limit(q.limit),
        opts.model.countDocuments(filter),
      ]);
      sendSuccess(res, items, { page: q.page, limit: q.limit, total });
    }),
  );

  router.get(
    '/:id',
    validate({ params: idParams }),
    asyncHandler(async (req, res) => {
      const doc = await opts.model.findById((req.validated!.params as Payload).id);
      if (!doc) throw AppError.notFound();
      sendSuccess(res, doc);
    }),
  );

  if (opts.createSchema) {
    router.post(
      '/',
      validate({ body: opts.createSchema }),
      asyncHandler(async (req, res) => {
        let data = req.validated!.body as Payload;
        if (opts.prepareCreate) data = await opts.prepareCreate(data);
        const doc = opts.create ? await opts.create(data) : await opts.model.create(data);
        sendSuccess(res, doc, undefined, 201);
      }),
    );
  }

  router.patch(
    '/:id',
    validate({ params: idParams, body: opts.updateSchema }),
    asyncHandler(async (req, res) => {
      const existing = await opts.model.findById((req.validated!.params as Payload).id);
      if (!existing) throw AppError.notFound();
      let data = req.validated!.body as Payload;
      if (opts.prepareUpdate) data = await opts.prepareUpdate(existing, data);
      existing.set(data);
      await existing.save();
      sendSuccess(res, existing);
    }),
  );

  // No DELETE on purpose: academic history is kept. Use PATCH { status: "inactive" }.
  return router;
}
