import 'reflect-metadata'

import { test } from '@japa/runner'
import {
  OperationMetadataStorage,
  OperationParameterMetadataStorage,
} from 'openapi-metadata/metadata'
import { RouterLoader } from '../src/router_loader.js'
import type { RouteJSON } from '@adonisjs/core/types/http'

function createRoute(overrides: Partial<RouteJSON> = {}): RouteJSON {
  return {
    pattern: '/tasks/:id',
    methods: ['GET', 'HEAD'],
    handler: { reference: [class TestController {}, 'show'] as any, handle: () => {} },
    matchers: {},
    domain: 'root',
    name: undefined,
    meta: {},
    middleware: [] as any,
    ...overrides,
  } as RouteJSON
}

function createRouterLoader(config?: { detect: boolean | 'auto'; params: boolean }) {
  const router = {
    matchers: {
      number: () => ({ match: /^\d+$/ }),
      uuid: () => ({ match: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/ }),
    },
  } as any

  const logger = {
    warn: () => {},
    info: () => {},
    error: () => {},
    debug: () => {},
  } as any

  return new RouterLoader(router, logger, config ?? { detect: true, params: true })
}

test.group('RouterLoader path conversion', () => {
  test('converts :param to {param} in path metadata', async ({ assert }) => {
    const loader = createRouterLoader()

    class Controller {
      show() {}
    }

    const route = createRoute({ pattern: '/tasks/:id' })
    await loader.detect(route, [Controller, 'show'])

    const metadata = OperationMetadataStorage.getMetadata(Controller.prototype, 'show')
    assert.equal(metadata.path, '/tasks/{id}')
  })

  test('converts multiple :params to {params}', async ({ assert }) => {
    const loader = createRouterLoader()

    class Controller {
      show() {}
    }

    const route = createRoute({ pattern: '/clients/:clientId/notes/:noteId' })
    await loader.detect(route, [Controller, 'show'])

    const metadata = OperationMetadataStorage.getMetadata(Controller.prototype, 'show')
    assert.equal(metadata.path, '/clients/{clientId}/notes/{noteId}')
  })

  test('handles paths without params', async ({ assert }) => {
    const loader = createRouterLoader()

    class Controller {
      index() {}
    }

    const route = createRoute({ pattern: '/tasks', methods: ['GET', 'HEAD'] })
    await loader.detect(route, [Controller, 'index'])

    const metadata = OperationMetadataStorage.getMetadata(Controller.prototype, 'index')
    assert.equal(metadata.path, '/tasks')
  })
})

test.group('RouterLoader parameter deduplication', () => {
  test('does not create duplicate params when already defined', async ({ assert }) => {
    const loader = createRouterLoader()

    class Controller {
      show() {}
    }

    // Pre-define a parameter (simulating decorator usage)
    OperationParameterMetadataStorage.defineMetadata(
      Controller.prototype,
      [{ name: 'id', in: 'path', required: true, type: 'string' }] as any,
      'show',
    )

    const route = createRoute({ pattern: '/tasks/:id' })
    await loader.detect(route, [Controller, 'show'])

    const params = OperationParameterMetadataStorage.getMetadata(Controller.prototype, 'show')
    const idParams = params.filter((p) => p.name === 'id' && p.in === 'path')
    assert.equal(idParams.length, 1)
  })

  test('deduplicates only pre-defined params, adds new ones', async ({ assert }) => {
    const loader = createRouterLoader()

    class Controller {
      show() {}
    }

    // Pre-define only clientId (simulating decorator usage)
    OperationParameterMetadataStorage.defineMetadata(
      Controller.prototype,
      [{ name: 'clientId', in: 'path', required: true, type: 'string' }] as any,
      'show',
    )

    const route = createRoute({ pattern: '/clients/:clientId/notes/:noteId' })
    await loader.detect(route, [Controller, 'show'])

    const params = OperationParameterMetadataStorage.getMetadata(Controller.prototype, 'show')
    assert.equal(params.length, 2)
    const clientIdParams = params.filter((p) => p.name === 'clientId')
    const noteIdParams = params.filter((p) => p.name === 'noteId')
    assert.equal(clientIdParams.length, 1)
    assert.equal(noteIdParams.length, 1)
  })

  test('adds new params that are not already defined', async ({ assert }) => {
    const loader = createRouterLoader()

    class Controller {
      show() {}
    }

    const route = createRoute({ pattern: '/clients/:clientId/notes/:noteId' })
    await loader.detect(route, [Controller, 'show'])

    const params = OperationParameterMetadataStorage.getMetadata(Controller.prototype, 'show')
    assert.equal(params.length, 2)
    assert.equal(params[0].name, 'clientId')
    assert.equal(params[1].name, 'noteId')
  })
})

test.group('RouterLoader schema placement', () => {
  test('places uuid format inside schema, not at parameter level', async ({ assert }) => {
    const loader = createRouterLoader()

    class Controller {
      show() {}
    }

    const route = createRoute({
      pattern: '/tasks/:id',
      matchers: {
        id: {
          match: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        },
      } as any,
    })
    await loader.detect(route, [Controller, 'show'])

    const params = OperationParameterMetadataStorage.getMetadata(Controller.prototype, 'show')
    const idParam = params.find((p) => p.name === 'id')
    assert.isDefined(idParam)

    // format should NOT be at the parameter level
    assert.notProperty(idParam, 'format')

    // format should be inside schema
    assert.deepInclude((idParam as any).schema, { type: 'string', format: 'uuid' })
  })

  test('places string type inside schema when no format is detected', async ({ assert }) => {
    const loader = createRouterLoader()

    class Controller {
      show() {}
    }

    const route = createRoute({ pattern: '/tasks/:id', matchers: {} })
    await loader.detect(route, [Controller, 'show'])

    const params = OperationParameterMetadataStorage.getMetadata(Controller.prototype, 'show')
    const idParam = params.find((p) => p.name === 'id')
    assert.isDefined(idParam)
    assert.notProperty(idParam, 'format')
    assert.notProperty(idParam, 'type')
    assert.deepInclude((idParam as any).schema, { type: 'string' })
  })

  test('places number type inside schema for number matchers', async ({ assert }) => {
    const loader = createRouterLoader()

    class Controller {
      show() {}
    }

    const route = createRoute({
      pattern: '/tasks/:id',
      matchers: {
        id: { match: /^\d+$/ },
      } as any,
    })
    await loader.detect(route, [Controller, 'show'])

    const params = OperationParameterMetadataStorage.getMetadata(Controller.prototype, 'show')
    const idParam = params.find((p) => p.name === 'id')
    assert.isDefined(idParam)
    assert.notProperty(idParam, 'type')
    assert.notProperty(idParam, 'format')
    assert.deepInclude((idParam as any).schema, { type: 'number' })
  })
})
