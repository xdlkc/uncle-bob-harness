Feature: FizzBuzz
  @story_s1a2b3c4d5e6
  Scenario: multiples of 15 are FizzBuzz
    Given an integer 15
    When fizzBuzz is evaluated
    Then the result is "FizzBuzz"
  Scenario: a plain number
    Given an integer 1
    When fizzBuzz is evaluated
    Then the result is "1"
