import { Given, When, Then } from '@cucumber/cucumber'
import assert from 'node:assert/strict'
import { fizzBuzz } from '../../src/index.ts'

let n = 0
let result = ''

Given('an integer {int}', (value: number) => {
  n = value
})

When('fizzBuzz is evaluated', () => {
  result = fizzBuzz(n)
})

Then('the result is {string}', (expected: string) => {
  assert.equal(result, expected)
})
