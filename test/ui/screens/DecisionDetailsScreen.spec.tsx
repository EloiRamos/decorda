import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';
import DecisionDetailsScreen from '../../../src/ui/screens/DecisionDetailsScreen';
import {referenceCandidateOptions} from '../../../src/domain/fixtures';
import {createReferenceConfirmedPlan, referencePendingResponses} from '../../../src/domain/decisionScenario';

describe('DecisionDetailsScreen', () => {
  it('renders bounded candidate tradeoffs with an accessible Back action', () => {
    const onBack = jest.fn();
    const screen = render(<DecisionDetailsScreen content={{kind: 'candidate', candidate: referenceCandidateOptions[1]}} onBack={onBack} />);
    expect(screen.getByText(/Does not match the soft outdoor preference/)).toBeTruthy();
    expect(screen.getByText('DECORDA')).toBeTruthy();
    expect(screen.getByText('BOUNDED CHILD VIEW')).toBeTruthy();
    expect(screen.getByText('COST')).toBeTruthy();
    expect(screen.getByText('RETURN TIME')).toBeTruthy();
    expect(screen.getByText('SETTING')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', {name: 'Back to decision'}));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('uses the inspected candidate rather than static prototype details', () => {
    const screen = render(<DecisionDetailsScreen content={{kind: 'candidate', candidate: referenceCandidateOptions[0]}} onBack={jest.fn()} />);
    expect(screen.getByText('Riverside Picnic')).toBeTruthy();
    expect(screen.getByText('42 EUR')).toBeTruthy();
    expect(screen.getByText(/Outdoor preference satisfied/)).toBeTruthy();
  });

  it('renders affected and preserved confirmed components', () => {
    const responses = referencePendingResponses().map(response => ({...response, response_state: 'approved' as const}));
    const plan = createReferenceConfirmedPlan('option-riverside-picnic', responses)!;
    const screen = render(<DecisionDetailsScreen content={{kind: 'confirmed', plan}} onBack={jest.fn()} />);
    expect(screen.getByText('Saturday activity')).toBeTruthy();
    expect(screen.getByText('Return-by-18:00 arrangement')).toBeTruthy();
  });
});
