import {connect, createAgent, listen} from '../index'

describe('P2P postMessage agent', () => {
  const messageConfirmationListener = (addEventListener as any).calls[0][1]

  beforeEach(() => {
    jest.useFakeTimers()
  })

  it('should register a message event global listener during module initialization', () => {
    expect((addEventListener as any).calls.length).toBe(1)
    const [callArgs] = (addEventListener as any).calls
    expect(callArgs.length).toBe(2)
    expect(callArgs[0]).toBe('message')
    expect(typeof callArgs[1]).toBe('function')
    expect(callArgs[1].length).toBe(1)
  })

  describe('connect', () => {
    it('should set up the specified connection to the provided target', async () => {
      const channel = `channel ${Math.random()}`
      const origin = `some.site${Math.random()}.com`
      const messageTimeout = Math.floor(Math.random() * 1000) + 10
      const retries = Math.floor(Math.random() * 3) + 1
      const retryDelay = Math.floor(Math.random() * 1000) + 10
      const mockPostMessage = jest.fn()
      const mockPostMessageCalls = mockPostMessage.mock.calls
      const mockTarget = {
        postMessage: mockPostMessage,
      }
      const connectionPromise = connect(mockTarget, {
        channel,
        handshakeRetries: retries,
        handshakeRetryDelay: retryDelay,
        origin,
        timeout: messageTimeout,
      })

      const knownMessageIds = []

      // let all the retries roll out
      for (let handshakeIteration = 0; handshakeIteration < retries; handshakeIteration++) {
        expect(mockPostMessage).toHaveBeenCalledTimes(handshakeIteration + 1)
        expect(mockPostMessage).toHaveBeenLastCalledWith(
          {
            channel,
            handshake: mockPostMessageCalls[handshakeIteration][0].handshake,
            messageId: mockPostMessageCalls[handshakeIteration][0].messageId,
          },
          origin,
          undefined,
        )
        expect(knownMessageIds.indexOf(mockPostMessageCalls[handshakeIteration][0].messageId)).toBe(-1)
        knownMessageIds.push(mockPostMessageCalls[handshakeIteration][0].messageId)
        expect(typeof mockPostMessageCalls[handshakeIteration][0].handshake).toBe('string')
        expect(mockPostMessageCalls[handshakeIteration][0].handshake).not.toBe('')
        expect(typeof mockPostMessageCalls[handshakeIteration][0].messageId).toBe('string')
        expect(mockPostMessageCalls[handshakeIteration][0].messageId).not.toBe('')
        jest.advanceTimersByTime(messageTimeout)
        expect(mockPostMessage).toHaveBeenCalledTimes(handshakeIteration + 1)
        await Promise.resolve().then(() => null) // wait for the catch callback of the handshake initiator to be invoked
        jest.advanceTimersByTime(retryDelay)
      }

      // accept the handshake
      expect(mockPostMessage).toHaveBeenCalledTimes(retries + 1)
      knownMessageIds.push(mockPostMessageCalls[retries][0].messageId)
      messageConfirmationListener({
        data: {
          channel,
          messageId: knownMessageIds[knownMessageIds.length - 1],
          received: true,
        },
        origin,
        source: mockTarget,
      })

      return connectionPromise
    })

    it('should reject the attempt if the handshake fails', async () => {
      const mockTarget = {
        postMessage: jest.fn(),
      }
      const connectionPromise = connect(mockTarget, {
        channel: 'foo',
        handshakeRetries: 1,
        handshakeRetryDelay: 100,
        origin: 'some.site.com',
        timeout: 100,
      })

      for (let i = 0; i < 2; i++) {
        jest.advanceTimersByTime(100)
        await Promise.resolve().then(() => null) // wait for the catch callback of the handshake initiator to be invoked
        jest.advanceTimersByTime(100)
      }

      try {
        await connectionPromise
      } catch (error) {
        return
      }

      throw new Error('The handshake should have been rejected')
    })

    it('should allow sending any data', async () => {
      const circular = {
        data: {} as {root?: unknown},
        num: 123,
      }
      circular.data.root = circular

      const mockTarget = {
        postMessage: jest.fn(),
      }
      const connectionPromise = connect(mockTarget, {
        channel: 'foo',
      })
      messageConfirmationListener({
        data: {
          channel: 'foo',
          messageId: mockTarget.postMessage.mock.calls[0][0].messageId,
          received: true,
        },
        origin: '*',
        source: mockTarget,
      })

      const connection = await connectionPromise
      connection(circular, [new ArrayBuffer(4)])

      expect(mockTarget.postMessage).toHaveBeenCalledTimes(2)
      expect(mockTarget.postMessage).toHaveBeenLastCalledWith(
        {
          channel: 'foo',
          data: circular,
          messageId: mockTarget.postMessage.mock.calls[1][0].messageId,
        },
        '*',
        [new ArrayBuffer(4)],
      )
    })
  })

  describe('listen', () => {
    it('should register a message event listener', () => {
      const channel = `channel ${Math.random()}`
      listen(channel, [], () => undefined)
      expect((addEventListener as any).calls.length).toBe(1)
      const [callArgs] = (addEventListener as any).calls
      expect(callArgs.length).toBe(2)
      expect(callArgs[0]).toBe('message')
      expect(typeof callArgs[1]).toBe('function')
      expect(callArgs[1].length).toBe(1)
    })

    it('should ignore an incoming message if the message\'s origin does not match the specified origins', () => {
      const callback = jest.fn()
      listen('foo', ['foo.bar.com'], callback)
      const listener = (addEventListener as any).calls[0][1]
      const sourcePostMessage = jest.fn()
      listener({
        data: {
          channel: 'foo',
          handshake: 'abc',
          messageId: 'abc,',
        },
        origin: 'baz.bar.com',
        source: {
          postMessage: sourcePostMessage,
        },
      })
      expect(callback).not.toHaveBeenCalled()
      expect(sourcePostMessage).not.toHaveBeenCalled()
    })

    it(
      'should ignore an incoming message if it has no source, no data, is missing message ID or has other channel ID',
      () => {
        const callback = jest.fn()
        listen('foo', ['foo.bar.com'], callback)
        const listener = (addEventListener as any).calls[0][1]
        const sourcePostMessage = jest.fn()
        listener({
          data: {
            channel: 'foo',
            handshake: 'abc',
            messageId: 'abc,',
          },
          origin: 'foo.bar.com',
        })
        listener({
          origin: 'foo.bar.com',
          source: {
            postMessage: sourcePostMessage,
          },
        })
        listener({
          data: {
            channel: 'foo',
            handshake: 'abc',
            messageId: 123,
          },
          origin: 'foo.bar.com',
          source: {
            postMessage: sourcePostMessage,
          },
        })
        listener({
          data: {
            channel: 'bar',
            handshake: 'abc',
            messageId: 'abc,',
          },
          origin: 'foo.bar.com',
          source: {
            postMessage: sourcePostMessage,
          },
        })
        expect(callback).not.toHaveBeenCalled()
        expect(sourcePostMessage).not.toHaveBeenCalled()
      },
    )

    it('should ignore an incoming message if it contains neither the handshake or data entry', () => {
      const callback = jest.fn()
      listen('foo', ['foo.bar.com'], callback)
      const listener = (addEventListener as any).calls[0][1]
      const sourcePostMessage = jest.fn()
      listener({
        data: {
          channel: 'foo',
          messageId: 'abc,',
        },
        origin: 'foo.bar.com',
        source: {
          postMessage: sourcePostMessage,
        },
      })
      expect(callback).not.toHaveBeenCalled()
      expect(sourcePostMessage).not.toHaveBeenCalled()
    })

    it('should reply to a handshake message without invoking the callback', () => {
      const callback = jest.fn()
      listen('foo', ['foo.bar.com'], callback)
      const listener = (addEventListener as any).calls[0][1]
      const sourcePostMessage = jest.fn()
      listener({
        data: {
          channel: 'foo',
          handshake: 'abc',
          messageId: 'abc,',
        },
        origin: 'foo.bar.com',
        source: {
          postMessage: sourcePostMessage,
        },
      })
      expect(callback).not.toHaveBeenCalled()
      expect(sourcePostMessage).toHaveBeenCalledTimes(1)
      expect(sourcePostMessage).toHaveBeenLastCalledWith(
        {
          channel: 'foo',
          messageId: 'abc,',
          received: true,
        },
        'foo.bar.com',
      )
    })

    it('should invoked the registered callback with the message\'s data payload and reply to the message', () => {
      const callback = jest.fn()
      listen('foo', ['foo.bar.com', 'baz.com'], callback)
      const listener = (addEventListener as any).calls[0][1]
      const data = Object.freeze({foo: `foo ${Math.random()}`})
      const sourcePostMessage = jest.fn()
      listener({
        data: {
          channel: 'foo',
          data,
          messageId: 'abc,',
        },
        origin: 'foo.bar.com',
        source: {
          postMessage: sourcePostMessage,
        },
      })
      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback).toHaveBeenLastCalledWith(data)
      expect(sourcePostMessage).toHaveBeenCalledTimes(1)
      expect(sourcePostMessage).toHaveBeenLastCalledWith(
        {
          channel: 'foo',
          messageId: 'abc,',
          received: true,
        },
        'foo.bar.com',
      )

      listener({
        data: {
          channel: 'foo',
          data: [1, 2, 4],
          messageId: 'abcd',
        },
        origin: 'baz.com',
        source: {
          postMessage: sourcePostMessage,
        },
      })
      expect(callback).toHaveBeenCalledTimes(2)
      expect(callback).toHaveBeenLastCalledWith([1, 2, 4])
      expect(sourcePostMessage).toHaveBeenCalledTimes(2)
      expect(sourcePostMessage).toHaveBeenLastCalledWith(
        {
          channel: 'foo',
          messageId: 'abcd',
          received: true,
        },
        'baz.com',
      )
    })
  })

  describe('createAgent', () => {
    it('should connect to the provided peer and listen for incoming messages', () => {
      const channel = `channel ${Math.random()}`
      const origin = `domain.${Math.random()}.dev`
      const peer = {
        postMessage: jest.fn(),
      }
      const onMessage = jest.fn()
      const connectionPromise = createAgent({
        channel,
        onMessage,
        origin,
        peer,
      })

      expect((addEventListener as any).calls.length).toBe(1)
      const addListenerCall = (addEventListener as any).calls[0]
      expect(addListenerCall.length).toBe(2)
      expect(addListenerCall[0]).toBe('message')
      expect(typeof addListenerCall[1]).toBe('function')
      expect(addListenerCall[1].length).toBe(1)
      const messageListener = addListenerCall[1]
      const mockMessageSource = {
        postMessage: jest.fn(),
      }
      messageListener({
        data: {
          channel,
          data: null,
          messageId: 'abc',
        },
        origin: 'other.origin.com',
        source: mockMessageSource,
      })
      expect(onMessage).not.toHaveBeenCalled()
      expect(mockMessageSource.postMessage).not.toHaveBeenCalled()
      messageListener({
        data: {
          channel,
          data: null,
          messageId: 'abc',
        },
        origin,
        source: mockMessageSource,
      })
      expect(onMessage).toHaveBeenCalledTimes(1)
      expect(mockMessageSource.postMessage).toHaveBeenCalledTimes(1)

      expect(peer.postMessage).toHaveBeenCalledTimes(1)
      expect(peer.postMessage).toHaveBeenLastCalledWith(
        {
          channel,
          handshake: peer.postMessage.mock.calls[0][0].handshake,
          messageId: peer.postMessage.mock.calls[0][0].messageId,
        },
        origin,
        undefined,
      )
      messageConfirmationListener({
        data: {
          channel,
          messageId: peer.postMessage.mock.calls[0][0].messageId,
          received: true,
        },
        origin,
        source: peer,
      })

      return connectionPromise
    })
  })

  afterEach(() => {
    ;(addEventListener as any).calls.splice(0) // tslint:disable-line align semicolon whitespace
    ;(postMessage as any).calls.splice(0) // tslint:disable-line align whitespace
    jest.clearAllTimers() // tslint:disable-line align
  })
})