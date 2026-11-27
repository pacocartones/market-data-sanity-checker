import process from 'node:process'

const body = process.env.MDSC_TEST_ALPHA_RESPONSE_BODY

if (body === undefined) {
  throw new Error('MDSC_TEST_ALPHA_RESPONSE_BODY is required')
}

globalThis.fetch = async () => new globalThis.Response(body)
