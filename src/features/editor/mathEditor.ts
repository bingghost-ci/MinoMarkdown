import { $remark } from '@milkdown/kit/utils'
import { remarkDemoteCurrency } from '../../core/markdown/math'

export const remarkDemoteCurrencyPlugin = $remark('remarkDemoteCurrency', () => remarkDemoteCurrency)
